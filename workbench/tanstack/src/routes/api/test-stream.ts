import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/test-stream')({
  server: {
    handlers: {
      GET: async () => {
        console.log('[Test] Creating test stream');

        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < 10; i++) {
              console.log(`[Test] Enqueueing ${i}`);
              controller.enqueue(new TextEncoder().encode(`${i}\n`));
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            console.log('[Test] Closing controller');
            controller.close();
          },
          cancel(reason) {
            console.log('[Test] Stream cancelled:', reason);
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-cache',
          },
        });
      },
    },
  },
});
