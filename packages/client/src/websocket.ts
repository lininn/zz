import {
  Emitter,
  VSBuffer,
  SocketProtocol,
  ChannelClient,
  type IMessagePassingProtocol,
  type ISocket,
} from "@zcode/rpc";
import type { IServiceAccessor } from "@zcode/services";
import { RemoteServiceAccess } from "./remoteServiceAccess.js";

export interface WebSocketConnectionCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

interface WebSocketConnectionOptions {
  onClose?: (event: WebSocketConnectionCloseEvent) => void;
  onOpenSocket?: (socket: WebSocket) => void;
}

function wrapBrowserWebSocket(ws: WebSocket): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  ws.binaryType = "arraybuffer";
  const handleMessage = (e: MessageEvent) => {
    onData.fire(VSBuffer.wrap(new Uint8Array(e.data as ArrayBuffer)));
  };
  const handleClose = () => {
    onClose.fire();
    onEnd.fire();
  };
  ws.addEventListener("message", handleMessage);
  ws.addEventListener("close", handleClose);
  ws.addEventListener("error", handleClose);

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer.buffer as Uint8Array<ArrayBuffer>);
      }
    },
    end() {
      ws.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("error", handleClose);
      onData.dispose();
      onClose.dispose();
      onEnd.dispose();
      ws.close();
    },
  };
}

export function connectViaWebSocket(
  wsUrl: string,
  options?: WebSocketConnectionOptions,
): Promise<IServiceAccessor> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let terminated = false;
    let socket: ISocket | undefined;
    let protocol: SocketProtocol | undefined;
    let client: ChannelClient | undefined;

    const terminate = (message: string) => {
      if (terminated) return;
      terminated = true;
      const error = new Error(message);
      error.name = "ConnectionClosed";
      // SocketProtocol 只负责分帧，不会消费 socket 的关闭事件。
      // 浏览器连接必须收口销毁 ChannelClient，才能拒绝已发送和等待 Initialize 的 RPC；
      // 否则目录读取、crew.create 会一直 pending，旧连接还会吞掉后续重试。
      client?.dispose(error);
      protocol?.dispose();
      if (!settled) {
        settled = true;
        reject(error);
      }
      if (socket) socket.dispose();
      else ws.close();
    };

    ws.addEventListener("error", () => {
      terminate("WebSocket connection failed");
    });
    ws.addEventListener("close", (event) => {
      terminate(
        event.reason
          ? `WebSocket connection closed: ${event.reason}`
          : `WebSocket connection closed (${event.code})`,
      );
      options?.onClose?.({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    });

    ws.addEventListener("open", () => {
      if (terminated) return;
      socket = wrapBrowserWebSocket(ws);
      protocol = new SocketProtocol(socket);
      client = new ChannelClient(protocol);
      // 先绑定 RPC 生命周期，再通知外部；回调可能同步关闭 socket。
      options?.onOpenSocket?.(ws);
      if (terminated) return;
      // 原生 close 事件异步派发，回调 close() 后 readyState 已经是 CLOSING。
      if (ws.readyState !== WebSocket.OPEN) {
        terminate("WebSocket connection closed before ready");
        return;
      }
      settled = true;
      resolve(new RemoteServiceAccess(client));
    });
  });
}

export function connectViaProtocol(
  protocol: IMessagePassingProtocol,
  options: { windowProjectDirectory?: boolean } = {},
): IServiceAccessor {
  const client = new ChannelClient(protocol);
  return new RemoteServiceAccess(client, options);
}
