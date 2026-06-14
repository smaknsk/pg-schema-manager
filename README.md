# PostgreSQL Schema Manager (`pg-schema-manager`)

A modular, declarative, object-per-file PostgreSQL database schema manager with incremental migrations, dependency-ordered inclusion plans, and reverse-engineering schema regeneration.

This project offers a developer-friendly micro-architecture for managing PostgreSQL databases, combining the advantages of declarative schema tracking (easy Git diffs, clean merges) with incremental migrations (safe production updates).

---

## 🌟 The Philosophy

Traditional migrations (e.g., Prisma Migrations, Liquibase, Knex) accumulate hundreds of migration files over time. This makes it extremely difficult to see the current state of a database schema in Git history, or to resolve merge conflicts in large teams.

`pg-schema-manager` solves this by introducing a **hybrid workflow**:
1. **Declarative Source of Truth (`src/schemas/`)**: Every database object (table, view, trigger, function, custom type, sequence, aggregate) is stored in its own dedicated SQL file.
2. **Relative Include Plan (`src/schemas/plan.sql`)**: A single master file that includes all individual SQL files using PostgreSQL's relative include command (`\ir`), organized in dependency-ordered passes.
3. **Incremental Migrations (`src/migrations/`)**: When you need to apply changes to staging/production, you create a migration and reference the declarative files using `-- include: file://...` comments. Running `make minc` inlines the contents, making migrations self-contained.
4. **Reverse Schema Regeneration (`make regenerate`)**: A Node.js script that reverse-engineers the database catalog of a running local Postgres instance and syncs the declarative `src/schemas/` directory with the database's actual state.

---

## 📂 Directory Layout

Once initialized in your project, the layout looks like this:

```
pgschema/
├── .env.dist                   # Database configuration template
├── Dockerfile                  # Migration runner Dockerfile
├── Makefile                    # Developer command suite
├── compose.yaml                # Local Postgres and migration services
├── bin/
│   ├── entrypoint.sh           # Waits for database container to be healthy
│   ├── migrate.sh              # Migration execution runner
│   ├── migrate-includes.sh    # Resolves and inlines -- include directives
│   ├── regenerate-schemas.js   # Dumps database objects back to declarative files
│   ├── dump-seeds.sh           # Exports seed data based on seeds plan
│   └── trigger-updated_at.sh   # Auto-generates updated_at triggers
└── src/
    ├── migrations/             # Chronological migration steps
    ├── schemas/                # Declarative object DDLs
    │   ├── plan.sql            # Master database definition schema plan
    │   └── <schema_name>/
    │       ├── schema.sql      # Schema definition and extensions
    │       ├── tables/         # Table DDLs
    │       ├── functions/      # Stored procedures and functions
    │       ├── views/          # SQL views
    │       ├── trigger/        # Triggers
    │       ├── types/          # ENUMs and composite types
    │       └── sequences/      # Sequences
    └── seeds/                  # Seed scripts
        ├── plan.sql            # Master seeding plan
        └── <schema_name>/      # Seed data files
```

---

## 🚀 Quick Start & AI Plugin Manual Installation

This package is designed to run as a plugin/extension across multiple developer AI assistant environments. Below are the instructions for manual installation on each supported platform.

### 🔌 Manual Installation for AI Assistants

#### 1. Google Antigravity (IDE/CLI)
Install the plugin directly from the GitHub repository using the `agy` CLI command:
```bash
agy plugin install https://github.com/smaknsk/pg-schema-manager.git
```
The Antigravity CLI and IDE will automatically clone, register the plugin metadata (`plugin.json`), and index the skill (`skills/pg-schema-manager/SKILL.md`).

Once installed, you can bootstrap the directory layout in your target database directory:
```bash
sh ~/.gemini/config/skills/pg-schema-manager/scripts/init.sh /path/to/your/project/pgschema
```

#### 2. Gemini CLI Extensions
Install the extension directly via Git:
```bash
gemini extensions install https://github.com/smaknsk/pg-schema-manager.git
```

*Note: For local offline development, you can clone the repository manually to `~/.gemini/config/plugins/pg-schema-manager/` (for Antigravity) or run `gemini extensions install /path/to/local/pg-schema-manager` (for Gemini CLI).*

#### 4. Claude Code
For projects using Claude Code, copy the specialized prompt handbook to your project rules:
```bash
cp /path/to/pg-schema-manager/platforms/claude/CLAUDE.md /path/to/your/project/.clauderules
```
This feeds guidelines directly to Claude regarding your object-per-file schema setup, migration compilation passes, and relative includes.

#### 5. OpenAI Codex / Cursor
For Cursor or Codex users, copy the rule definitions to the root of your project:
```bash
cp /path/to/pg-schema-manager/platforms/codex/CODEX.md /path/to/your/project/.cursorrules
# or .agentrules for other Codex integrations
```

---

### 📂 Adding New AI Assistants (Future-Proof Structure)

To add support for a new AI platform (e.g. Copilot, Windsurf, Qodo), simply:
1. Create a folder under `platforms/<platform_name>/`.
2. Add a `<PLATFORM>.md` instructions guide defining how the assistant should interact with this schema.
3. Document manual loading steps in this README.

---

### 💻 Local Environment Setup

1. Once your project directory is initialized (using `init.sh` above), go to your target database folder:
   ```bash
   cd /path/to/your/project/pgschema
   ```
2. Copy the template database configuration:
   ```bash
   cp .env.dist .env
   ```
3. Start the PostgreSQL container:
   ```bash
   make up
   ```

---

## 🛠️ Usage Workflow

### Step A: Defining a New Table
1. Create a table file under `src/schemas/public/tables/users.sql`:
   ```sql
   CREATE TABLE public.users (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       email text NOT NULL UNIQUE,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
   );
   ```
2. Add a relative include to `src/schemas/plan.sql`:
   ```sql
   \ir public/tables/users.sql
   ```

### Step B: Creating a Migration
1. Generate a new chronological migration:
   ```bash
   make new create_users_table
   ```
   This creates a file like `src/migrations/20260614142000--create_users_table.sql`.
2. Add an include reference pointing to your declarative table file inside the migration:
   ```sql
   -- include: file://../schemas/public/tables/users.sql
   ```
3. Compile the includes to inline the table DDL:
   ```bash
   make minc
   ```
4. Apply the migration locally:
   ```bash
   make migrate
   ```

### Step C: Auto-Generating Triggers
If your table has an `updated_at` column, you can auto-generate the trigger definition:
```bash
make trigger-updated_at public
```
This automatically updates `src/schemas/public/trigger/update_updated_at.sql`.

### Step D: Synchronizing Declarative Files
If you make schema modifications directly in your database GUI client (or apply third-party migrations), you can pull those changes back into Git-tracked declarative files:
```bash
make regenerate
```
This will query the PostgreSQL catalog, rewrite individual SQL files under `src/schemas/`, and update the global `src/schemas/plan.sql` dependency map.

---

## 💡 Developer Commands

| Command | Description |
| :--- | :--- |
| `make` | Show all available commands and descriptions. |
| `make up` | Start local Postgres database. |
| `make downv` | Stop Postgres and delete its volume (wipes all local data). |
| `make reset` | Restart local Postgres container. |
| `make migrate` | Execute all pending migrations in `src/migrations/`. |
| `make new <name>` | Generate a new blank migration file. |
| `make minc` | Inline `-- include: file://...` links in the latest migration file. |
| `make seeds` | Run the seeds script from `src/seeds/plan.sql`. |
| `make plan` | Initialize database directly from `src/schemas/plan.sql` (faster than migrations). |
| `make regenerate` | Export database tables/functions back into declarative single-object files. |
| `make dump-seeds` | Dump seed data from Postgres into `src/seeds/` files. |
| `make trigger-updated_at <schema>` | Auto-generate updated_at triggers for all tables containing `updated_at`. |
| `make rms` | Fully wipe, start container, apply all migrations, and load seeds. |
| `make rps` | Fully wipe, start container, apply schema plan.sql directly, and load seeds. |

---

## 📝 License

This project is open-source and available under the [MIT License](LICENSE).
