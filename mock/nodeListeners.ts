// MSW's WebSocket links share one BroadcastChannel and add a listener per
// link and per open socket. Six Decaid channels with their sockets pass
// Node's default warning threshold of 10, which is noise, not a leak. This
// must run before msw is first evaluated, so mock/node.ts imports it first.
import { setMaxListeners } from 'node:events';

setMaxListeners(64);
