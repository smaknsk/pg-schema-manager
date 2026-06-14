#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse .env if it exists
const dotenvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(dotenvPath)) {
  const envConfig = fs.readFileSync(dotenvPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const parts = line.trim().split('=');
    if (parts.length >= 2 && !parts[0].startsWith('#')) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  }
}

const host = process.env.POSTGRES_HOST || 'localhost';
const port = process.env.POSTGRES_PORT || '5432';
const user = process.env.POSTGRES_USER || 'postgres';
const pass = process.env.POSTGRES_PASSWORD || 'postgres';
const db = process.env.POSTGRES_DB || 'postgres';

const schemasDir = path.resolve(__dirname, '../src/schemas');

const IGNORED_TABLES = [
  'public.schema_migrations',
];

function queryDb(sql) {
  const env = { ...process.env, PGPASSWORD: pass };
  if (process.env.USE_DOCKER === 'true' || process.env.POSTGRES_HOST === 'postgres') {
    const composeFile = process.env.COMPOSE_FILE || 'compose.yaml';
    const composePath = path.resolve(__dirname, '../', composeFile);
    const cmd = `docker compose -f "${composePath}" exec -T postgres psql -U "${user}" -d "${db}" -t -A`;
    return execSync(cmd, { input: sql, encoding: 'utf8' }).trim();
  } else {
    const cmd = `psql -h "${host}" -p "${port}" -U "${user}" -d "${db}" -t -A`;
    return execSync(cmd, { input: sql, env, encoding: 'utf8' }).trim();
  }
}

function dumpTable(schema, table) {
  const env = { ...process.env, PGPASSWORD: pass };
  if (process.env.USE_DOCKER === 'true' || process.env.POSTGRES_HOST === 'postgres') {
    const composeFile = process.env.COMPOSE_FILE || 'compose.yaml';
    const composePath = path.resolve(__dirname, '../', composeFile);
    const cmd = `docker compose -f "${composePath}" exec -T postgres pg_dump -U "${user}" -d "${db}" --schema-only -t "${schema}.${table}"`;
    return execSync(cmd, { encoding: 'utf8' });
  } else {
    const cmd = `pg_dump -h "${host}" -p "${port}" -U "${user}" -d "${db}" --schema-only -t "${schema}.${table}"`;
    return execSync(cmd, { env, encoding: 'utf8' });
  }
}

function cleanTableSql(rawSql) {
  const lines = rawSql.split('\n');
  const cleanLines = [];
  const foreignKeys = [];
  
  let inAlter = false;
  let alterBuffer = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') continue;
    if (trimmed.startsWith('SET ') || trimmed.startsWith('SELECT pg_catalog.set_config')) continue;
    if (trimmed.includes('OWNER TO')) continue;
    if (trimmed.startsWith('CREATE TRIGGER') || trimmed.startsWith('CREATE OR REPLACE TRIGGER') || trimmed.startsWith('CREATE CONSTRAINT TRIGGER')) continue;
    if (trimmed.startsWith('\\restrict') || trimmed.startsWith('\\unrestrict')) continue;
    
    if (trimmed.startsWith('ALTER TABLE ONLY ')) {
      inAlter = true;
      alterBuffer = [line];
      continue;
    }
    
    if (inAlter) {
      alterBuffer.push(line);
      if (trimmed.endsWith(';')) {
        inAlter = false;
        const fullStatement = alterBuffer.join('\n');
        if (fullStatement.includes('FOREIGN KEY')) {
          foreignKeys.push(fullStatement);
        } else {
          cleanLines.push(fullStatement);
        }
      }
      continue;
    }
    
    cleanLines.push(line);
  }
  
  return {
    tableSql: cleanLines.join('\n').trim() + '\n',
    foreignKeys: foreignKeys.length > 0 ? foreignKeys.join('\n') + '\n' : ''
  };
}

function main() {
  const isSubset = process.argv.length > 2;
  let mainPlanSchemas = process.argv.slice(2);

  if (mainPlanSchemas.length === 0) {
    try {
      const schemasSql = `
        SELECT COALESCE(json_agg(nspname), '[]'::json) 
        FROM (
          SELECT nspname 
          FROM pg_namespace 
          WHERE left(nspname, 3) != 'pg_' 
            AND nspname != 'information_schema'
          ORDER BY nspname
        ) t;
      `;
      mainPlanSchemas = JSON.parse(queryDb(schemasSql));
    } catch (err) {
      console.warn('Could not query schemas from database, falling back to reading src/schemas/ directory:', err.message);
      mainPlanSchemas = fs.readdirSync(schemasDir).filter(f => {
        return fs.statSync(path.join(schemasDir, f)).isDirectory();
      }).sort();
    }
  }

  console.log(`Found schemas to regenerate: ${mainPlanSchemas.join(', ')}`);

  // Fetch active extensions to put them in public/schema.sql
  const extensionsSql = `SELECT extname FROM pg_extension WHERE extname != 'plpgsql';`;
  let extensions = [];
  try {
    extensions = queryDb(extensionsSql).split('\n').map(e => e.trim()).filter(Boolean);
  } catch (err) {
    console.warn('Could not query extensions (db might be empty/initializing):', err.message);
  }

  const allTypes = [];
  const allSequences = [];
  const allFuncsBefore = [];
  const allTables = [];
  const allFuncsAfter = [];
  const allAggs = [];
  const allTriggers = [];
  const allViews = [];
  const allForeignKeys = [];

  for (const schema of mainPlanSchemas) {
    console.log(`Processing schema: ${schema}...`);

    const schemaPath = path.join(schemasDir, schema);
    const typesDir = path.join(schemaPath, 'types');
    const sequencesDir = path.join(schemaPath, 'sequences');
    const functionsDir = path.join(schemaPath, 'functions');
    const tablesDir = path.join(schemaPath, 'tables');
    const aggregatesDir = path.join(schemaPath, 'aggregates');
    const triggerDir = path.join(schemaPath, 'trigger');
    const viewsDir = path.join(schemaPath, 'views');

    // Clean up directories if they exist, or create them
    const dirs = [typesDir, sequencesDir, functionsDir, tablesDir, aggregatesDir, triggerDir, viewsDir];
    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        // Remove existing .sql files in the directory
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));
        for (const file of files) {
          fs.unlinkSync(path.join(dir, file));
        }
      } else {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Clean up existing schema-specific foreign_keys.sql if any
    const fkFile = path.join(schemaPath, 'foreign_keys.sql');
    if (fs.existsSync(fkFile)) {
      fs.unlinkSync(fkFile);
    }
    const localPlanFile = path.join(schemaPath, 'plan.sql');
    if (fs.existsSync(localPlanFile)) {
      fs.unlinkSync(localPlanFile);
    }

    // 1. Write schema.sql (include extensions for public schema)
    const schemaCommentSql = `
      SELECT COALESCE(
        (
          SELECT 'COMMENT ON SCHEMA ' || n.nspname || ' IS ' || quote_literal(des.description) || ';'
          FROM pg_namespace n
          JOIN pg_description des ON des.objoid = n.oid AND des.classoid = 'pg_namespace'::regclass
          WHERE n.nspname = '${schema}'
        ),
        ''
      );
    `;
    let schemaComment = '';
    try {
      schemaComment = queryDb(schemaCommentSql).trim();
    } catch (err) {
      console.warn(`Could not query schema comment for ${schema}:`, err.message);
    }

    let schemaSqlContent = `CREATE SCHEMA IF NOT EXISTS ${schema};\n`;
    if (schemaComment) {
      schemaSqlContent += `${schemaComment}\n`;
    }
    if (schema === 'public' && extensions.length > 0) {
      for (const ext of extensions) {
        schemaSqlContent += `CREATE EXTENSION IF NOT EXISTS "${ext}";\n`;
      }
    }
    fs.writeFileSync(path.join(schemaPath, 'schema.sql'), schemaSqlContent);

    // 2. Fetch and write Types (ENUMs, Composite Types, Domains, excluding extension-owned)
    const typesSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        -- ENUMs
        SELECT 
          t.typname AS type_name,
          'CREATE TYPE ' || n.nspname || '.' || t.typname || ' AS ENUM (' || 
          string_agg('''' || e.enumlabel || '''', ', ' ORDER BY e.enumsortorder) || 
          ');' || COALESCE(
            (
              SELECT '\nCOMMENT ON TYPE ' || n.nspname || '.' || t.typname || ' IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = t.oid AND des.classoid = 'pg_type'::regclass
            ),
            ''
          ) AS definition
        FROM pg_type t 
        JOIN pg_enum e ON t.oid = e.enumtypid 
        JOIN pg_namespace n ON n.oid = t.typnamespace 
        LEFT JOIN pg_depend d ON d.objid = t.oid AND d.classid = 'pg_type'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' AND d.objid IS NULL
        GROUP BY n.nspname, t.typname, t.oid
        
        UNION ALL
        
        -- COMPOSITE TYPEs
        SELECT 
          t.typname AS type_name,
          'CREATE TYPE ' || n.nspname || '.' || t.typname || ' AS (' || 
          string_agg(quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum) || 
          ');' || COALESCE(
            (
              SELECT '\nCOMMENT ON TYPE ' || n.nspname || '.' || t.typname || ' IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = t.oid AND des.classoid = 'pg_type'::regclass
            ),
            ''
          ) AS definition
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        JOIN pg_class c ON t.typrelid = c.oid
        JOIN pg_attribute a ON c.oid = a.attrelid
        LEFT JOIN pg_depend d ON d.objid = t.oid AND d.classid = 'pg_type'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' 
          AND t.typtype = 'c' 
          AND c.relkind = 'c'
          AND a.attnum > 0 
          AND NOT a.attisdropped
          AND d.objid IS NULL
        GROUP BY n.nspname, t.typname, t.oid
        
        UNION ALL
        
        -- DOMAINs
        SELECT 
          t.typname AS type_name,
          'CREATE DOMAIN ' || n.nspname || '.' || t.typname || ' AS ' || pg_catalog.format_type(t.typbasetype, t.typtypmod) ||
          CASE WHEN t.typdefault IS NOT NULL THEN ' DEFAULT ' || t.typdefault ELSE '' END ||
          COALESCE(
            (
              SELECT ' ' || string_agg('CONSTRAINT ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid), ' ')
              FROM pg_constraint con
              WHERE con.contypid = t.oid
            ),
            ''
          ) || ';' || COALESCE(
            (
              SELECT '\nCOMMENT ON TYPE ' || n.nspname || '.' || t.typname || ' IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = t.oid AND des.classoid = 'pg_type'::regclass
            ),
            ''
          ) AS definition
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        LEFT JOIN pg_depend d ON d.objid = t.oid AND d.classid = 'pg_type'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' 
          AND t.typtype = 'd'
          AND d.objid IS NULL
        GROUP BY n.nspname, t.typname, t.typbasetype, t.typtypmod, t.typdefault, t.oid
        
        ORDER BY type_name
      ) t;
    `;
    let types = [];
    try {
      types = JSON.parse(queryDb(typesSql));
    } catch (err) {
      console.warn(`Could not parse types for ${schema}:`, err.message);
    }
    for (const t of types) {
      fs.writeFileSync(path.join(typesDir, `${t.type_name}.sql`), `${t.definition}\n`);
      allTypes.push(`${schema}/types/${t.type_name}.sql`);
    }

    // 2b. Fetch and write Standalone Sequences
    const sequencesSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT 
          s.sequencename AS seq_name,
          'CREATE SEQUENCE ' || s.schemaname || '.' || s.sequencename || 
          ' START WITH ' || s.start_value || 
          ' INCREMENT BY ' || s.increment_by || 
          ' MINVALUE ' || s.min_value || 
          ' MAXVALUE ' || s.max_value || 
          CASE WHEN s.cycle THEN ' CYCLE' ELSE ' NO CYCLE' END || 
          ' CACHE ' || s.cache_size || ';' || COALESCE(
            (
              SELECT '\nCOMMENT ON SEQUENCE ' || s.schemaname || '.' || s.sequencename || ' IS ' || quote_literal(des.description) || ';'
              FROM pg_class cl
              JOIN pg_description des ON des.objoid = cl.oid AND des.classoid = 'pg_class'::regclass
              WHERE cl.relname = s.sequencename AND cl.relnamespace = n.oid
            ),
            ''
          ) AS definition
        FROM pg_sequences s
        JOIN pg_namespace n ON n.nspname = s.schemaname
        JOIN pg_class c ON c.relname = s.sequencename AND c.relnamespace = n.oid
        LEFT JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'a'
        WHERE s.schemaname = '${schema}' AND d.objid IS NULL
        ORDER BY s.sequencename
      ) t;
    `;
    let sequences = [];
    try {
      sequences = JSON.parse(queryDb(sequencesSql));
    } catch (err) {
      console.warn(`Could not parse sequences for ${schema}:`, err.message);
    }
    for (const seq of sequences) {
      fs.writeFileSync(path.join(sequencesDir, `${seq.seq_name}.sql`), `${seq.definition}\n`);
      allSequences.push(`${schema}/sequences/${seq.seq_name}.sql`);
    }

    // 3. Fetch and write Functions and Procedures (excluding extension-owned)
    const funcsSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT 
          p.proname AS function_name,
          pg_get_functiondef(p.oid) || ';' || COALESCE(
            (
              SELECT '\n\nCOMMENT ON ' || CASE WHEN p.prokind = 'p' THEN 'PROCEDURE ' ELSE 'FUNCTION ' END ||
                     n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = p.oid AND des.classoid = 'pg_proc'::regclass
            ),
            ''
          ) AS definition,
          (
            (r.typtype = 'c' AND r.typnamespace != 'pg_catalog'::regnamespace) OR
            EXISTS (
              SELECT 1 
              FROM unnest(p.proargtypes) argtype_oid
              JOIN pg_type argt ON argt.oid = argtype_oid
              WHERE argt.typtype = 'c' AND argt.typnamespace != 'pg_catalog'::regnamespace
            ) OR
            l.lanname = 'sql'
          ) AS depends_on_table
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_type r ON r.oid = p.prorettype
        JOIN pg_language l ON l.oid = p.prolang
        LEFT JOIN pg_depend d ON d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}'
          AND p.prokind IN ('f', 'p')
          AND r.typname != 'trigger'
          AND d.objid IS NULL
        ORDER BY p.proname
      ) t;
    `;
    let funcs = [];
    try {
      funcs = JSON.parse(queryDb(funcsSql));
    } catch (err) {
      console.warn(`Could not parse functions for ${schema}:`, err.message);
    }
    const funcsBefore = funcs.filter(f => !f.depends_on_table);
    const funcsAfter = funcs.filter(f => f.depends_on_table);

    for (const f of funcsBefore) {
      let def = f.definition.trim();
      if (!def.endsWith(';')) {
        def += ';';
      }
      fs.writeFileSync(path.join(functionsDir, `${f.function_name}.sql`), `${def}\n`);
      allFuncsBefore.push(`${schema}/functions/${f.function_name}.sql`);
    }

    // 4. Fetch and write Tables (extracting foreign keys, excluding extension-owned)
    const tablesSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' AND c.relkind = 'r' AND d.objid IS NULL
        ORDER BY c.relname
      ) t;
    `;
    let tables = [];
    try {
      tables = JSON.parse(queryDb(tablesSql));
    } catch (err) {
      console.warn(`Could not parse tables for ${schema}:`, err.message);
    }
    let schemaForeignKeys = '';
    
    for (const tbl of tables) {
      if (IGNORED_TABLES.includes(`${schema}.${tbl.table_name}`)) {
        console.log(`Skipping ignored table: ${schema}.${tbl.table_name}`);
        continue;
      }
      let rawSql = '';
      try {
        rawSql = dumpTable(schema, tbl.table_name);
      } catch (err) {
        console.error(`Failed to dump table ${schema}.${tbl.table_name}:`, err.message);
        continue;
      }
      const { tableSql, foreignKeys } = cleanTableSql(rawSql);
      fs.writeFileSync(path.join(tablesDir, `${tbl.table_name}.sql`), tableSql);
      allTables.push(`${schema}/tables/${tbl.table_name}.sql`);
      if (foreignKeys) {
        schemaForeignKeys += foreignKeys;
      }
    }

    // Write schema-specific foreign_keys.sql if we have any
    if (schemaForeignKeys.trim()) {
      fs.writeFileSync(path.join(schemaPath, 'foreign_keys.sql'), schemaForeignKeys);
      allForeignKeys.push(`${schema}/foreign_keys.sql`);
    }

    // 5. Fetch and write Functions (Table dependent)
    for (const f of funcsAfter) {
      let def = f.definition.trim();
      if (!def.endsWith(';')) {
        def += ';';
      }
      fs.writeFileSync(path.join(functionsDir, `${f.function_name}.sql`), `${def}\n`);
      allFuncsAfter.push(`${schema}/functions/${f.function_name}.sql`);
    }

    // 5b. Fetch and write Custom Aggregates
    const aggregatesSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT 
          p.proname AS aggregate_name,
          'CREATE AGGREGATE ' || n.nspname || '.' || p.proname || '(' || 
          COALESCE(pg_catalog.pg_get_function_arguments(p.oid), '') || ') (' ||
          'SFUNC = ' || a.aggtransfn::text ||
          ', STYPE = ' || a.aggtranstype::regtype::text ||
          CASE WHEN a.agginitval IS NOT NULL THEN ', INITCOND = ' || quote_literal(a.agginitval) ELSE '' END ||
          CASE WHEN a.aggfinalfn::oid <> 0 THEN ', FINALFUNC = ' || a.aggfinalfn::text ELSE '' END ||
          CASE WHEN a.aggcombinefn::oid <> 0 THEN ', COMBINEFUNC = ' || a.aggcombinefn::text ELSE '' END ||
          CASE WHEN a.aggserialfn::oid <> 0 THEN ', SERIALFUNC = ' || a.aggserialfn::text ELSE '' END ||
          CASE WHEN a.aggdeserialfn::oid <> 0 THEN ', DESERIALFUNC = ' || a.aggdeserialfn::text ELSE '' END ||
          CASE WHEN a.aggsortop::oid <> 0 THEN ', SORTOP = ' || a.aggsortop::regoper::text ELSE '' END ||
          ');' || COALESCE(
            (
              SELECT '\nCOMMENT ON AGGREGATE ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = p.oid AND des.classoid = 'pg_proc'::regclass
            ),
            ''
          ) AS definition
        FROM pg_aggregate a
        JOIN pg_proc p ON a.aggfnoid = p.oid
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_depend d ON d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' AND d.objid IS NULL
        ORDER BY p.proname
      ) t;
    `;
    let aggregates = [];
    try {
      aggregates = JSON.parse(queryDb(aggregatesSql));
    } catch (err) {
      console.warn(`Could not parse aggregates for ${schema}:`, err.message);
    }
    for (const agg of aggregates) {
      fs.writeFileSync(path.join(aggregatesDir, `${agg.aggregate_name}.sql`), `${agg.definition}\n`);
      allAggs.push(`${schema}/aggregates/${agg.aggregate_name}.sql`);
    }

    // 6. Fetch and write Triggers (excluding extension-owned)
    const triggersSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT 
          p.proname AS function_name,
          pg_get_functiondef(p.oid) || ';' || COALESCE(
            (
              SELECT '\n\nCOMMENT ON FUNCTION ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = p.oid AND des.classoid = 'pg_proc'::regclass
            ),
            ''
          ) AS function_def,
          (
            SELECT json_agg(
              pg_get_triggerdef(tg.oid) || ';' || COALESCE(
                (
                  SELECT '\nCOMMENT ON TRIGGER ' || quote_ident(tg.tgname) || ' ON ' || n.nspname || '.' || c.relname || ' IS ' || quote_literal(des.description) || ';'
                  FROM pg_description des
                  WHERE des.objoid = tg.oid AND des.classoid = 'pg_trigger'::regclass
                ),
                ''
              )
              ORDER BY tg.tgname
            )
            FROM pg_trigger tg
            JOIN pg_class c ON tg.tgrelid = c.oid
            WHERE tg.tgfoid = p.oid AND NOT tg.tgisinternal
          ) AS trigger_defs
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_type r ON r.oid = p.prorettype
        LEFT JOIN pg_depend d ON d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' AND r.typname = 'trigger' AND d.objid IS NULL
        ORDER BY p.proname
      ) t;
    `;
    let triggers = [];
    try {
      triggers = JSON.parse(queryDb(triggersSql));
    } catch (err) {
      console.warn(`Could not parse triggers for ${schema}:`, err.message);
    }
    for (const trg of triggers) {
      let content = '';
      if (trg.function_def) {
        let funcDef = trg.function_def.trim();
        if (!funcDef.endsWith(';')) {
          funcDef += ';';
        }
        content += `${funcDef}\n\n`;
      }
      if (trg.trigger_defs && trg.trigger_defs.length > 0) {
        for (const trgDef of trg.trigger_defs) {
          let def = trgDef.trim();
          if (!def.endsWith(';')) {
            def += ';';
          }
          content += `${def}\n`;
        }
      }
      fs.writeFileSync(path.join(triggerDir, `${trg.function_name}.sql`), content);
      allTriggers.push(`${schema}/trigger/${trg.function_name}.sql`);
    }

    // 7. Fetch and write Views and Materialized Views (excluding extension-owned)
    const viewsSql = `
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT 
          c.relname AS view_name,
          CASE 
            WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' || n.nspname || '.' || c.relname || ' AS' || chr(10) || pg_get_viewdef(c.oid, true)
            ELSE 'CREATE OR REPLACE VIEW ' || n.nspname || '.' || c.relname || ' AS' || chr(10) || pg_get_viewdef(c.oid, true)
          END || COALESCE(
            (
              SELECT '\nCOMMENT ON ' || CASE WHEN c.relkind = 'm' THEN 'MATERIALIZED VIEW ' ELSE 'VIEW ' END ||
                     n.nspname || '.' || c.relname || ' IS ' || quote_literal(des.description) || ';'
              FROM pg_description des
              WHERE des.objoid = c.oid AND des.classoid = 'pg_class'::regclass
            ),
            ''
          ) AS definition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e'
        WHERE n.nspname = '${schema}' AND c.relkind IN ('v', 'm') AND d.objid IS NULL
        ORDER BY c.relname
      ) t;
    `;
    let views = [];
    try {
      views = JSON.parse(queryDb(viewsSql));
    } catch (err) {
      console.warn(`Could not parse views for ${schema}:`, err.message);
    }
    for (const v of views) {
      let def = v.definition.trim();
      if (!def.endsWith(';')) {
        def += ';';
      }
      fs.writeFileSync(path.join(viewsDir, `${v.view_name}.sql`), `${def}\n`);
      allViews.push(`${schema}/views/${v.view_name}.sql`);
    }

    // Clean up empty directories
    for (const dir of dirs) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    }
  }

  // Rewrite main plan.sql using a multi-pass dependency layout
  if (isSubset) {
    console.log('Skipping updating global plan.sql because a subset of schemas was processed.');
  } else {
    const mainPlanPath = path.join(schemasDir, 'plan.sql');
    let mainPlanContent = '';

    // Pass 1: Create Schemas
    mainPlanContent += `-- Pass 1: Schemas\n`;
    for (const s of mainPlanSchemas) {
      mainPlanContent += `\\ir ${s}/schema.sql\n`;
    }

    // Pass 2: Types (ENUMs/Composites/Domains)
    if (allTypes.length > 0) {
      mainPlanContent += `\n-- Pass 2: Types\n`;
      for (const file of allTypes) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 3: Sequences
    if (allSequences.length > 0) {
      mainPlanContent += `\n-- Pass 3: Sequences\n`;
      for (const file of allSequences) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 4: Functions (independent of tables)
    if (allFuncsBefore.length > 0) {
      mainPlanContent += `\n-- Pass 4: Functions\n`;
      for (const file of allFuncsBefore) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 5: Tables
    if (allTables.length > 0) {
      mainPlanContent += `\n-- Pass 5: Tables\n`;
      for (const file of allTables) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 6: Functions (dependent on tables)
    if (allFuncsAfter.length > 0) {
      mainPlanContent += `\n-- Pass 6: Functions (Table dependent)\n`;
      for (const file of allFuncsAfter) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 7: Aggregates
    if (allAggs.length > 0) {
      mainPlanContent += `\n-- Pass 7: Aggregates\n`;
      for (const file of allAggs) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 8: Triggers
    if (allTriggers.length > 0) {
      mainPlanContent += `\n-- Pass 8: Triggers\n`;
      for (const file of allTriggers) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 9: Views
    if (allViews.length > 0) {
      mainPlanContent += `\n-- Pass 9: Views\n`;
      for (const file of allViews) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    // Pass 10: Foreign Keys
    if (allForeignKeys.length > 0) {
      mainPlanContent += `\n-- Pass 10: Foreign Keys\n`;
      for (const file of allForeignKeys) {
        mainPlanContent += `\\ir ${file}\n`;
      }
    }

    fs.writeFileSync(mainPlanPath, mainPlanContent);
    console.log('Global plan.sql updated.');
  }

  console.log('Regeneration complete!');
}

main();
