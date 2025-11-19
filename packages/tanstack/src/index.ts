// import path from "node:path";
// import fs from "fs-extra";

import { TanStackStartBuilder } from './builder.js';

const builder = new TanStackStartBuilder();

// This needs to be in the top-level as we need to create these
// entries before svelte plugin is started or the entries are
// a race to be created before svelte discovers entries
console.log('Building workflow...');
await builder.build();

export { workflowPlugin } from './plugin.js';
