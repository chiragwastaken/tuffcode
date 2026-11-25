import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { TodoService } from './service.js';

export function createTodoHandlers(deps: { todos: TodoService }): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('todos.get', (params) => deps.todos.get((params as RpcParams<'todos.get'>).threadId));
  return handlers;
}
