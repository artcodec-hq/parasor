#!/usr/bin/env node

import { runCli } from "../packages/server/src/cli/main.js";

await runCli(process.argv.slice(2));
