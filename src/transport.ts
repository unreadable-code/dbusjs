import {createConnection, type Socket} from "net";

export interface UnixDomainAddress {
    transport: "unix";
    guid?: string;
}

export interface UnixDomainPathAddress extends UnixDomainAddress {
    path: string;
}

export interface UnixDomainSocketAddress extends UnixDomainAddress {
    socket: string;
}

export interface UnixDomainAbstractAddress {
    transport: "unix";
    abstract: string;
    guid?: string;
}

export type Address = UnixDomainPathAddress | UnixDomainSocketAddress | UnixDomainAbstractAddress;

function requireIndex(value: string, token: string, offset: number, error: string): number {
    const index = value.indexOf(token, offset);
    if (index < 0)
        throw new Error(error);

    return index;
}

export function parseAddress(value: string): Address {
    let index = requireIndex(value, ":", 0, "Invalid dbus address, no transport indicator");
    const transport = value.slice(0, index);
    const params: Record<string, string> = {};
    while (index < value.length) {
        const valueIndex = 1 + requireIndex(value, "=", index, "Invalid dbus address part, missing equal sign");
        const paramName = value.slice(index, valueIndex);
        const delimiterIndex = value.indexOf(",", index);
        if (delimiterIndex < 0) {
            params[paramName] = value.slice(valueIndex);
            break;
        } else {
            params[paramName] = value.slice(valueIndex, delimiterIndex);
            index = delimiterIndex;
        }
    }

    switch (transport) {
    case "unix":
        params.transport = transport;
        if (!params.path && !params.abstract)
            throw new Error("Invalid unix domain address, missing path");

        return params as unknown as Address;

    default:
        throw new Error("Unsupported address type");
    }
}

function createSocket(address: Address): Socket {
    let path = (address as UnixDomainAbstractAddress).abstract;
    if (path)
        return createConnection(`\u0000${path}`);

    path = (address as UnixDomainPathAddress).path || (address as UnixDomainSocketAddress).socket;
    return createConnection(path);
}

export const enum AuthMethod {
    External = "EXTERNAL",
    Anonymous = "ANONYMOUS",
}

export class Connection {
    private nextCallID = 1;
    private responseHandlers = new Map<number, (data: Uint8Array) => void>();

    // The parts of a multi-part message
    private receivedParts: Uint8Array[] = [];

    // How many more bytes are needed before the next message is fully received
    private receiveDue: number = 0;

    constructor(private readonly socket: Socket) {
        this.socket.on("data", this.onData.bind(this));
    }

    close(): void {
        this.socket.end();
    }

    private async onData(data: Uint8Array): Promise<void> {
        if (this.receiveDue) {
            this.receivedParts.push(data);

            if (this.receiveDue > data.byteLength) {
                // Still need to read more, add this to the pile and wait
                this.receiveDue -= data.byteLength;
                return;
            } else {
                data = Buffer.concat(this.receivedParts);
                this.receiveDue = 0;
            }
        }

        // The data received might be multiple messages concatenated
        do {
            const view = new DataView(data.buffer);
            const messageLength = view.getUint32(4, true);

            // Handle incomplete message
            if (messageLength > data.byteLength) {
                this.receiveDue = messageLength - data.byteLength;
                this.receivedParts = [data];
                return;
            }

            const messageID = view.getUint32(8, true);
            const handler = this.responseHandlers.get(messageID);
            if (handler) {
                // Handle a call response
                handler(data.subarray(8));
                this.responseHandlers.delete(messageID);
            }

            data = data.subarray(messageLength);
        } while (data.byteLength);
    }

    sendAndReceive(payload: Uint8Array): Promise<Uint8Array> {
        const callID = this.nextCallID;
        this.nextCallID = callID > (1 << 31) ? 1 : callID + 2;
        const view = new DataView(payload.buffer);
        view.setUint32(8, callID);
        return new Promise((resolve) => {
            // TODO: Implement timeouts
            this.responseHandlers.set(callID, resolve);
            this.socket.write(payload);
        });
    }

    private static tryExternalAuth(socket: Socket, id: string) {
        socket.write(`AUTH EXTERNAL ${id}\r\n`);
    }

    private static tryAuth(socket: Socket, methods: string[]): void {
        const uid = process.getuid && process.getuid();
        const id = Buffer.from(uid!.toString(), "ascii").toString("hex");

        for (const method of methods) {
            switch (method) {
            case AuthMethod.External:
                Connection.tryExternalAuth(socket, id);
                break;
            case AuthMethod.Anonymous:
                socket.write("AUTH ANONYMOUS \r\n");
                break;
            default:
                throw new Error(`Unsupported dbus auth method ${method}`);
            }
        }
    }

    static open(address: Address): Promise<Connection> {
        return new Promise((resolve, reject) => {
            const socket = createSocket(address);
            socket.once("error", reject);
            socket.once("connect", () => {
                socket.write(new Uint8Array(1));
                Connection.tryAuth(socket, ["EXTERNAL", "ANONYMOUS"]);

                socket.removeListener("error", reject);
                const connection = new Connection(socket);
                resolve(connection);
            });
        });
    }
}
