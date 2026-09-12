# DouValue farm sync server

GENERATED. Do not edit `main.ts` here: change `../core.mjs` and run

    node douvalue/scripts-build-deno.mjs

This folder exists so it can be deployed on its own. It holds one file, which is
the whole server, so pointing Deno Deploy at this directory needs no entry point
and no configuration.

The farm app then connects to whatever address the deployment is given, under
Settings, Sync, Connect the farm.
