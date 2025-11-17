const fs = require('fs');
const path = require('path');

// Read the TypeScript file and extract STEPS data
const tsContent = fs.readFileSync('lib/elements-data.ts', 'utf8');

// Extract STEPS array using regex
const stepsMatch = tsContent.match(
  /export const STEPS: Step\[\] = \[([\s\S]*?)\n\];/
);
if (!stepsMatch) {
  console.error('Could not find STEPS array');
  process.exit(1);
}

// Parse the steps - this is a simple extraction
const stepsText = stepsMatch[1];

// Extract individual step objects
const stepMatches = [...stepsText.matchAll(/\{[\s\S]*?(?=\n  \},|\n\],)/g)];

console.log('🔨 Building workflow registry...\n');
console.log(`Found ${stepMatches.length} steps to process`);

// Create public/r directory
const registryDir = path.join(process.cwd(), 'public', 'r');
fs.mkdirSync(registryDir, { recursive: true });

const registryItems = [];

// For each step, extract key information
stepMatches.forEach((match, index) => {
  const stepText = match[0];

  // Extract id
  const idMatch = stepText.match(/id: '([^']+)'/);
  const nameMatch = stepText.match(/name: '([^']+)'/);
  const descMatch = stepText.match(/description:\s*'([^']+)'/);
  const codeMatch = stepText.match(/code: `([\s\S]*?)`,/);
  const depsMatch = stepText.match(/dependencies: \[([\s\S]*?)\]/);

  if (!idMatch || !nameMatch || !descMatch || !codeMatch) {
    console.log(`⚠️  Skipping step ${index + 1} - missing required fields`);
    return;
  }

  const id = idMatch[1];
  const name = nameMatch[1];
  const description = descMatch[1];
  const code = codeMatch[1];

  // Extract dependencies
  let dependencies = [];
  if (depsMatch) {
    dependencies = depsMatch[1]
      .split(',')
      .map((d) => d.trim().replace(/['"`]/g, ''))
      .filter((d) => d.length > 0);
  }

  console.log(`📦 Generating registry for: ${id}`);

  const registryItem = {
    name: id,
    type: 'registry:block',
    title: name,
    description: description,
    registryDependencies: [],
    dependencies: dependencies,
    files: [
      {
        path: `registry/steps/${id}.tsx`,
        type: 'registry:component',
        content: code,
        target: `components/steps/${id}.tsx`,
      },
    ],
  };

  // Write individual step registry file
  const itemPath = path.join(registryDir, `${id}.json`);
  fs.writeFileSync(itemPath, JSON.stringify(registryItem, null, 2));

  // Add to main registry items list
  registryItems.push({
    name: id,
    type: 'registry:block',
    title: name,
    description: description,
  });
});

// Generate main registry.json
const mainRegistry = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: 'workflow-elements',
  homepage: 'https://workflow-registry.vercel.app',
  items: registryItems,
};

const registryPath = path.join(registryDir, 'registry.json');
fs.writeFileSync(registryPath, JSON.stringify(mainRegistry, null, 2));

console.log(
  `\n✅ Successfully generated ${registryItems.length} registry items`
);
console.log(`📁 Registry files written to: public/r/`);
console.log(`\n📋 Main registry: public/r/registry.json`);
console.log(`\nUsers can now install steps via:`);
console.log(`  npx shadcn@latest add @workflow/send-slack-message`);
console.log(`  npx shadcn@latest add @workflow/openai-chat`);
