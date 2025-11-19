import { constants } from 'node:fs';
import { access, mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BaseBuilder,
  createBaseBuilderConfig,
  VercelBuildOutputAPIBuilder,
  type TanStackConfig,
} from '@workflow/builders';

// NOTE: This is the same as SvelteKit/Astro request converter, should merge
const NORMALIZE_REQUEST_CONVERTER = `
async function normalizeRequestConverter(request) {
  const options = {
    method: request.method,
    headers: new Headers(request.headers)
  };
  if (!['GET', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'].includes(request.method)) {
    options.body = await request.arrayBuffer();
  }
  return new Request(request.url, options);
} `;

const WORKFLOW_ROUTES = [
  {
    src: '^/\\.well-known/workflow/v1/flow/?$',
    dest: '/.well-known/workflow/v1/flow',
  },
  {
    src: '^/\\.well-known/workflow/v1/step/?$',
    dest: '/.well-known/workflow/v1/step',
  },
  {
    src: '^/\\.well-known/workflow/v1/webhook/([^/]+?)/?$',
    dest: '/.well-known/workflow/v1/webhook/[token]',
  },
];

export class LocalBuilder extends BaseBuilder {
  constructor(config?: Partial<TanStackConfig>) {
    const workingDir = config?.workingDir || process.cwd();

    super({
      ...config,
      dirs: ['src'],
      buildTarget: 'tanstack' as const,
      stepsBundlePath: '', // unused in base
      workflowsBundlePath: '', // unused in base
      webhookBundlePath: '', // unused in base
      workingDir,
    });
  }

  override async build(): Promise<void> {
    // Find SvelteKit routes directory (src/routes or routes)
    const routesDir = await this.findRoutesDirectory();
    // TanStack Start requires `[.]` for escaping
    const workflowGeneratedDir = join(routesDir, '[.]well-known/workflow/v1');

    // Ensure output directories exist
    await mkdir(workflowGeneratedDir, { recursive: true });

    // Add .gitignore to exclude generated files from version control
    if (process.env.VERCEL_DEPLOYMENT_ID === undefined) {
      await writeFile(join(workflowGeneratedDir, '.gitignore'), '*');
    }

    // Get workflow and step files to bundle
    const inputFiles = await this.getInputFiles();
    const tsConfig = await this.getTsConfigOptions();

    const options = {
      inputFiles,
      workflowGeneratedDir,
      tsBaseUrl: tsConfig.baseUrl,
      tsPaths: tsConfig.paths,
    };

    // Generate the three SvelteKit route handlers
    await this.buildStepsRoute(options);
    await this.buildWorkflowsRoute(options);
    await this.buildWebhookRoute({ workflowGeneratedDir });
  }

  private async buildStepsRoute({
    inputFiles,
    workflowGeneratedDir,
    tsPaths,
    tsBaseUrl,
  }: {
    inputFiles: string[];
    workflowGeneratedDir: string;
    tsBaseUrl?: string;
    tsPaths?: Record<string, string[]>;
  }) {
    // Create steps route: well-known/workflow/v1/step.ts
    // Should be .ts since that's what TanStack Router expects
    const stepsRouteFile = join(workflowGeneratedDir, 'step.ts');
    await this.createStepsBundle({
      format: 'esm',
      inputFiles,
      outfile: stepsRouteFile,
      externalizeNonSteps: true,
      tsBaseUrl,
      tsPaths,
    });

    let stepsRouteContent = await readFile(stepsRouteFile, 'utf-8');

    // Normalize request, needed for preserving request through TanStack
    stepsRouteContent = stepsRouteContent.replace(
      /export\s*\{\s*stepEntrypoint\s+as\s+POST\s*\}\s*;?$/m,
      `${NORMALIZE_REQUEST_CONVERTER}
export const POST = async ({ request }) => {
  const normalRequest = await normalizeRequestConverter(request);
  return stepEntrypoint(normalRequest);
};`
    );

    stepsRouteContent = `// @ts-nocheck
${stepsRouteContent}
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/.well-known/workflow/v1/step")({
  server: {
    handlers: {
      POST
    }
  }
});
`;
    await writeFile(stepsRouteFile, stepsRouteContent);
  }

  private async buildWorkflowsRoute({
    inputFiles,
    workflowGeneratedDir,
    tsPaths,
    tsBaseUrl,
  }: {
    inputFiles: string[];
    workflowGeneratedDir: string;
    tsBaseUrl?: string;
    tsPaths?: Record<string, string[]>;
  }) {
    // Create workflows route: .well-known/workflow/v1/flow.ts
    // Should be .ts since that's what TanStack Router expects
    const workflowRouteFile = join(workflowGeneratedDir, 'flow.ts');
    await this.createWorkflowsBundle({
      format: 'esm',
      outfile: join(workflowGeneratedDir, 'flow.ts'),
      bundleFinalOutput: false,
      inputFiles,
      tsBaseUrl,
      tsPaths,
    });

    let workflowsRouteContent = await readFile(workflowRouteFile, 'utf-8');

    // Normalize request, needed for preserving request through TanStack
    workflowsRouteContent = workflowsRouteContent.replace(
      /export const POST = workflowEntrypoint\(workflowCode\);?$/m,
      `${NORMALIZE_REQUEST_CONVERTER}
export const POST = async ({request}) => {
  const normalRequest = await normalizeRequestConverter(request);
  return workflowEntrypoint(workflowCode)(normalRequest);
};`
    );

    workflowsRouteContent = `// @ts-nocheck
${workflowsRouteContent}
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/.well-known/workflow/v1/flow")({
  server: {
    handlers: {
      POST
    }
  }
});
`;
    await writeFile(workflowRouteFile, workflowsRouteContent);
  }

  private async buildWebhookRoute({
    workflowGeneratedDir,
  }: {
    workflowGeneratedDir: string;
  }) {
    // Create webhook directory
    const webhookDir = join(workflowGeneratedDir, 'webhook');
    await mkdir(webhookDir, { recursive: true });

    // Create webhook route: .well-known/workflow/v1/webhook/$token.ts
    const webhookRouteFile = join(webhookDir, '$token.ts');

    await this.createWebhookBundle({
      outfile: webhookRouteFile,
      bundle: false, // TanStack will handle bundling
      suppressUndefinedRejections: true,
    });

    let webhookRouteContent = await readFile(webhookRouteFile, 'utf-8');

    // Update handler to extract token from URL path
    webhookRouteContent = webhookRouteContent.replace(
      /async function handler\(request\) \{[\s\S]*?const token = decodeURIComponent\(pathParts\[pathParts\.length - 1\]\);/,
      `async function handler(request, token) {
  const decodedToken = decodeURIComponent(token);`
    );

    // Replace the token variable usage with decodedToken
    webhookRouteContent = webhookRouteContent.replace(
      /await webhookHandler\(request, token\)/g,
      'await webhookHandler(request, decodedToken)'
    );

    // Remove the URL parsing code since we get token from params
    webhookRouteContent = webhookRouteContent.replace(
      /const url = new URL\(request\.url\);[\s\S]*?const pathParts = url\.pathname\.split\('\/'\);/g,
      ''
    );

    // Replace exports with TanStack Start handlers
    webhookRouteContent = webhookRouteContent.replace(
      /export const GET = handler;[\s\S]*?export const OPTIONS = handler;/,
      `${NORMALIZE_REQUEST_CONVERTER}

const createHandler = () => async ({ request, params }) => {
  const normalRequest = await normalizeRequestConverter(request);
  return handler(normalRequest, params.token);
};

export const GET = createHandler();
export const POST = createHandler();
export const PUT = createHandler();
export const PATCH = createHandler();
export const DELETE = createHandler();
export const HEAD = createHandler();
export const OPTIONS = createHandler();`
    );

    // Add TanStack Router route definition
    webhookRouteContent = `// @ts-nocheck
${webhookRouteContent}
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/.well-known/workflow/v1/webhook/$token")({
  server: {
    handlers: {
      GET,
      POST,
      PUT,
      PATCH,
      DELETE,
      HEAD,
      OPTIONS
    }
  }
});
`;

    await writeFile(webhookRouteFile, webhookRouteContent);
  }

  private async findRoutesDirectory(): Promise<string> {
    const routesDir = resolve(this.config.workingDir, 'src/routes');
    const rootRoutesDir = resolve(this.config.workingDir, 'routes');

    // Try src/routes first (standard SvelteKit convention)
    try {
      await access(routesDir, constants.F_OK);
      const routesStats = await stat(routesDir);
      if (!routesStats.isDirectory()) {
        throw new Error(`Path exists but is not a directory: ${routesDir}`);
      }
      return routesDir;
    } catch {
      // Try routes as fallback
      try {
        await access(rootRoutesDir, constants.F_OK);
        const rootRoutesStats = await stat(rootRoutesDir);
        if (!rootRoutesStats.isDirectory()) {
          throw new Error(
            `Path exists but is not a directory: ${rootRoutesDir}`
          );
        }
        return rootRoutesDir;
      } catch {
        throw new Error(
          'Could not find SvelteKit routes directory. Expected either "src/routes" or "routes" to exist.'
        );
      }
    }
  }
}

export class VercelBuilder extends VercelBuildOutputAPIBuilder {
  constructor() {
    const workingDir = process.cwd();
    super({
      ...createBaseBuilderConfig({
        workingDir,
        dirs: ['src/pages', 'src/workflows'],
      }),
      buildTarget: 'vercel-build-output-api',
    });
  }

  override async build(): Promise<void> {
    console.log('building for vercel');
    const configPath = join(
      this.config.workingDir,
      '.vercel/output/config.json'
    );

    // The config output by nitro
    const config = JSON.parse(await readFile(configPath, 'utf-8'));

    // Find the index right after the "filesystem" handler and "continue: true" routes
    let insertIndex = config.routes.findIndex(
      (route: any) => route.handle === 'filesystem'
    );

    // Move past any routes with "continue: true" (like _astro cache headers)
    while (
      insertIndex < config.routes.length - 1 &&
      config.routes[insertIndex + 1]?.continue === true
    ) {
      insertIndex++;
    }

    // Insert workflow routes right after
    config.routes.splice(insertIndex + 1, 0, ...WORKFLOW_ROUTES);

    // Bundles workflows for vercel
    await super.build();

    // Use old nitro config with updated routes
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
}
