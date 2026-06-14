---
name: pg-schema-manager
description: Declarative database schema management with object-per-file structures, chronological migrations, relative includes, and database schema regeneration.
---

# Declarative Database Schema Manager Skill

This skill provides a standard layout and set of utilities for managing PostgreSQL databases in a highly modular, declarative, and developer-friendly way.

## 🌟 The Philosophy

Traditional database migration tools (like Prisma Migrations, Liquibase, or Knex) have a fatal flaw: over time, you accumulate hundreds of migration files, making it extremely difficult to see the current state of a table, function, or view in Git history, or to resolve merge conflicts.

This architecture uses a hybrid approach:
1. **Declarative State (`src/schemas/`)**: Every database object (table, view, trigger, function, custom type, sequence, aggregate) is stored in its own dedicated SQL file. This is the **source of truth** for the current state of the database and is easily tracked/diffed in Git.
2. **Relative Include Plan (`src/schemas/plan.sql`)**: A single master file that includes all individual object files using the relative include command (`\ir`) of `psql`, organized in dependency-ordered passes.
3. **Incremental Migrations (`src/migrations/`)**: For applying changes to live environments. Instead of manually copying definitions into migration files, you reference them using `-- include: file://...` comments, which are automatically compiled/inlined into the migration.
4. **Automated Schema Regeneration (`make regenerate`)**: A script that reverse-engineers the database catalog from a running local instance and recreates the declarative `src/schemas/` directory structure.

---

## 📂 Directory Structure

Once initialized, the database schema package will look like this:

```
pgschema/
├── .env.dist                   # Template for database credentials
├── Dockerfile                  # Builds a Docker image containing migrations
├── Makefile                    # Make command suite for DB operations
├── compose.yaml                # Starts local Postgres & runner services
├── bin/
│   ├── entrypoint.sh           # Docker entrypoint (waits for Postgres)
│   ├── migrate.sh              # Bash migration runner
│   ├── migrate-includes.sh    # Compiles -- include: commands in migrations
│   ├── regenerate-schemas.js   # Dumps database objects back to files
│   ├── dump-seeds.sh           # Dumps seed data for tables listed in seeds plan
│   └── trigger-updated_at.sh   # Auto-generates updated_at triggers
└── src/
    ├── migrations/             # Chronological migration steps (e.g. 1.0.0--init.sql)
    ├── schemas/                # Declarative object definitions
    │   ├── plan.sql            # Master import plan for the schemas
    │   └── <schema_name>/
    │       ├── schema.sql      # Schema definition and extensions
    │       ├── tables/         # Individual table DDLs
    │       ├── functions/      # Stored procedures & SQL/PLpgSQL functions
    │       ├── views/          # SQL views
    │       ├── trigger/        # Table triggers
    │       ├── types/          # Custom ENUMs and composite types
    │       └── sequences/      # Database sequences
    └── seeds/                  # Seed SQL scripts
        ├── plan.sql            # Master import plan for seeding
        └── <schema_name>/      # Seed data files
```

---

## 🛠️ Usage Workflow

### 1. Initialization
To setup this structure in a new target directory:
```bash
sh /Users/smak/.gemini/config/skills/pg-schema-manager/scripts/init.sh /path/to/target/directory
```

### 2. local Environment Setup
Copy the template environment configuration and modify it:
```bash
cp .env.dist .env
```
Run `make up` to spin up a local PostgreSQL container.

### 3. Adding a New Table, Function, or View
1. Create a file under `src/schemas/<schema_name>/[tables|functions|views]/<object_name>.sql`.
2. Reference the file in `src/schemas/plan.sql` using relative includes:
   ```sql
   \ir <schema_name>/tables/<object_name>.sql
   ```
3. Create a migration file:
   ```bash
   make new my_new_table
   ```
4. Reference the file in the migration file (`src/migrations/YYYYMMDDHHMMSS--my_new_table.sql`):
   ```sql
   -- include: file://../schemas/<schema_name>/tables/<object_name>.sql
   ```
5. Compile the include to pull the contents of the table DDL into the migration:
   ```bash
   make minc
   ```
6. Apply the migration:
   ```bash
   make migrate
   ```

### 4. Regenerating Schema Declarations from Local DB
If you write or alter tables/functions directly in a DB client or pull database states, you can sync the declarative files automatically:
```bash
make regenerate
```
This updates the single-object files in `src/schemas/` and the global `src/schemas/plan.sql` file.

### 5. Seeding Database
Seeds are managed under `src/seeds/`. Table inserts are generated and managed by a plan file `src/seeds/plan.sql`.
To dump existing data into seed files:
```bash
make dump-seeds
```
To load seed data:
```bash
make seeds
```

---

## 💡 Developer Commands Cheat Sheet

| Command | Description |
| :--- | :--- |
| `make` | List all available commands and descriptions. |
| `make up` | Start local Postgres container and wait 1s. |
| `make downv` | Stop local Postgres and delete its volume (wipes all DB data). |
| `make reset` | Wipes and restarts local Postgres database. |
| `make migrate` | Run all pending migrations in `src/migrations/`. |
| `make new <name>` | Generate a new SQL migration file. |
| `make minc` | Inlines `-- include: file://...` links in the latest migration file. |
| `make seeds` | Run the seed script `src/seeds/plan.sql`. |
| `make plan` | Initialize database directly from `src/schemas/plan.sql` (faster than migrations). |
| `make regenerate` | Dumps current DB schema into declarative file-per-object structures. |
| `make dump-seeds` | Exports data from Postgres into `src/seeds` files. |
| `make trigger-updated_at` | Auto-generates updated_at triggers for all tables containing `updated_at`. |
