'use client';

import type { Step, WorkflowRun } from '@workflow/world';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: WorkflowRun['status'] | Step['status'];
  context?: { error?: unknown };
  className?: string;
}

export function StatusBadge({ status, context, className }: StatusBadgeProps) {
  const getStatusClasses = () => {
    switch (status) {
      case 'running':
        return 'text-blue-600 dark:text-blue-600 font-medium capitalize text-sm';
      case 'completed':
        return 'text-green-600 dark:text-green-600 font-medium capitalize text-sm';
      case 'failed':
        return 'text-red-600 dark:text-red-600 font-medium capitalize text-sm';
      case 'cancelled':
        return 'text-yellow-600 dark:text-yellow-600 font-medium capitalize text-sm';
      case 'pending':
        return 'text-gray-600 dark:text-gray-600 font-medium capitalize text-sm';
      case 'paused':
        return 'text-orange-600 dark:text-orange-600 font-medium capitalize text-sm';
      default:
        return 'text-gray-600 dark:text-gray-600 font-medium capitalize text-sm';
    }
  };

  // Show error tooltip if status is failed and error exists
  if (status === 'failed' && context?.error) {
    const errorMessage =
      typeof context.error === 'string'
        ? context.error
        : context.error instanceof Error
          ? context.error.message
          : JSON.stringify(context.error);

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'border-b border-dotted cursor-help',
              getStatusClasses(),
              className
            )}
          >
            {status}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md">
          <p className="text-xs whitespace-pre-wrap break-words">
            {errorMessage}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return <span className={cn(getStatusClasses(), className)}>{status}</span>;
}
