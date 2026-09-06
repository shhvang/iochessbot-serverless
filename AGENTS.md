# Rich Chess serverless bot

This is a Telegram Serverless project. Runtime code is JavaScript under `handlers/` and `lib/`, plus `schema.js`.

Use bare module imports (`schema`, `lib/chess`, `sdk`). Deploy with `npx tgcloud push`, then apply schema changes with `npx tgcloud migrate`.
