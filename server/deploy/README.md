# DouValue farm sync server

GENERATED. Do not edit `main.ts` here: change `../core.mjs` and run

    node scripts-build-deno.mjs

This folder exists so it can be deployed on its own. `main.ts` is the whole
server and the entry point. `deno.json` turns on Deno KV, which the server
stores everything in; without it the deploy fails at boot with
"Deno.openKv is not a function". Keep both files together.

On Deno Deploy, also create a Deno KV database under Databases and assign it
to the app.

The farm app then connects to whatever address the deployment is given, under
Settings, Sync, Connect the farm.
