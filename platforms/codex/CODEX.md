# OpenAI Codex / Cursor Rules: `pg-schema-manager`

This file provides system instructions and prompt rules for OpenAI Codex and Cursor AI when working in projects using the `pg-schema-manager` database architecture.

## How to Load these Rules in Cursor / Codex

To feed these instructions to Cursor or Codex, you can:
1. Copy the contents of this file to your local `.cursorrules` or `.agentrules` file at the project root.
2. Or explicitly reference this file in your session:
   > "Read platforms/codex/CODEX.md and follow the database structure guidelines."

---

## 🛠️ Database Layout & Workflow Guidelines

### 1. Object-per-File DDL Location
All tables, views, triggers, functions, custom types, sequences, and aggregates MUST be created as separate SQL files under:
`src/schemas/<schema_name>/[tables|functions|views|trigger|types|sequences]/<name>.sql`

### 2. Relative Include Plan (`plan.sql`)
Whenever you add or delete a database object SQL file, you MUST register/deregister it inside:
`src/schemas/plan.sql`
using relative include comments:
`\ir <schema_name>/[tables|functions|views|...]/<name>.sql`
Ensure the includes are ordered correctly by database dependencies.

### 3. Creating and Compiling Migrations
When adding database modifications:
1. Generate a new chronological migration:
   `make new <description_name>`
2. Reference the DDL files inside the newly generated SQL file under `src/migrations/` using:
   `-- include: file://../schemas/<schema_name>/<type>/<name>.sql`
3. Compile the includes to inline the definitions:
   `make minc`
4. Apply migrations:
   `make migrate`

### 4. Database Schema Synchronization
If you modify schemas directly or apply migrations in a DB client, synchronize the files:
`make regenerate`
This will query the DB system catalog and recreate files in `src/schemas/` and the global `src/schemas/plan.sql` plan.
