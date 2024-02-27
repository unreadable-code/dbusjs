import {createConnection, type Socket} from "net";

import {DataType} from ".";
import {IntrospectionResult} from "./introspection";
import {Builder as MessageBuilder, Header, Kind as MessageKind, Reader} from "./message";

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
    let delimiterIndex = requireIndex(value, ":", 0, "Invalid dbus address, no transport indicator");
    const transport = value.slice(0, delimiterIndex);
    const params: Record<string, string> = {};
    while (delimiterIndex < value.length) {
        const valueIndex = 1 + requireIndex(value, "=", delimiterIndex, "Invalid dbus address part, missing equal sign");
        ++delimiterIndex;
        const paramName = value.slice(delimiterIndex, valueIndex - 1);
        delimiterIndex = value.indexOf(",", delimiterIndex);
        if (delimiterIndex < 0) {
            params[paramName] = value.slice(valueIndex);
            break;
        } else {
            params[paramName] = value.slice(valueIndex, delimiterIndex);
        }
    }

    switch (params.transport = transport) {
    case "unix":
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
    private nextCallID = 32;
    private responseHandlers = new Map<number, (data: Reader) => void>();

    // The parts of a multi-part message
    private receivedParts: Uint8Array[] = [];

    // How many more bytes are needed before the next message is fully received
    private receiveDue: number = 0;

    constructor(private readonly socket: Socket) {
        this.socket.addListener("data", this.onData.bind(this));
    }

    close(): void {
        this.socket.end();
    }

    private onData(data: Uint8Array): void {
        let view: DataView;

        if (this.receiveDue) {
            this.receivedParts.push(data);

            if (this.receiveDue > data.byteLength) {
                // Still need to read more, add this to the pile and wait
                this.receiveDue -= data.byteLength;
                return;
            } else {
                view = new DataView(Buffer.concat(this.receivedParts).buffer);
                this.receiveDue = 0;
            }
        } else {
            view = new DataView(data.buffer);
        }

        // The data received might be multiple messages concatenated
        do {
            const reader = new Reader(view);

            const bodySize = reader.getBodySize();
            const headerFieldsSize = reader.getHeaderFieldsSize();
            const messageSize = 16 + 8 * Math.trunc((headerFieldsSize + 7) / 8) + bodySize;

            // Handle incomplete message
            if (messageSize > view.byteLength) {
                this.receiveDue = messageSize - view.byteLength;
                this.receivedParts = [new Uint8Array(view.buffer.slice(view.byteOffset))];
                return;
            }

            const messageID = reader.getReplySerial();
            if (messageID) {
                const handler = this.responseHandlers.get(messageID);
                if (handler) {
                    // Handle a call response
                    handler(new Reader(new DataView(view.buffer, view.byteOffset, messageSize)));
                    this.responseHandlers.delete(messageID);
                }
            }

            view = new DataView(view.buffer, view.byteOffset + messageSize);
        } while (view.byteLength);
    }

    sendAndReceive(value: ArrayBuffer): Promise<Reader> {
        const callID = this.nextCallID;
        this.nextCallID = callID > (1 << 31) ? 1 : callID + 1;
        new DataView(value).setUint32(8, callID, true);
        return new Promise(resolve => {
            // TODO: Implement timeouts
            this.responseHandlers.set(callID, resolve);
            this.socket.write(new Uint8Array(value));
        });
    }

    private static tryExternalAuth(socket: Socket) {
        const uid = process.getuid && process.getuid();
        const id = Buffer.from(uid!.toString(), "ascii").toString("hex");
        socket.write(`AUTH EXTERNAL ${id}\r\n`);
    }

    private static textDecoder = new TextDecoder("utf8");
    private static textDecodeOptions = {stream: true};

    private static handshake(
        socket: Socket,
        methods: string[],
        resolve: (c: Connection) => void,
        reject: (e: Error) => void,
    ): void {
        socket.write("\0");

        function introduce(): void {
            const message = new MessageBuilder(MessageKind.Call);
            message.setHeader(Header.Path, DataType.ObjectPath, "/org/freedesktop/DBus");
            message.setHeader(Header.Member, DataType.String, "Hello");
            message.setHeader(Header.Interface, DataType.String, "org.freedesktop.DBus");
            message.setHeader(Header.Destination, DataType.String, "org.freedesktop.DBus");

            const connection = new Connection(socket);
            connection.sendAndReceive(message.build())
                .then(() => resolve(connection), reject);
        }

        function proposeAuth(socket: Socket, method: string): void {
            switch (method) {
            case AuthMethod.External:
                Connection.tryExternalAuth(socket);
                break;

            case AuthMethod.Anonymous:
                socket.write("AUTH ANONYMOUS \r\n");
                break;

            default:
                socket.removeListener("data", onHandshakeData);
                reject(new Error(`Unsupported dbus auth method ${method}`));
            }
        }

        let nextMethod = 0;
        let bufferedText = "";
        function onHandshakeData(data: Uint8Array): void {
            bufferedText += Connection.textDecoder.decode(data, Connection.textDecodeOptions);
            const delimiterIndex = bufferedText.indexOf("\r\n");
            if (delimiterIndex > -1) {
                if (bufferedText.startsWith("OK ")) {
                    socket.removeListener("data", onHandshakeData);
                    socket.write("BEGIN\r\n", introduce);
                } else if (nextMethod === methods.length) {
                    socket.removeListener("data", onHandshakeData);
                    reject(new Error("No auth methods can be used"));
                } else {
                    proposeAuth(socket, methods[++nextMethod]);
                }

                bufferedText = bufferedText.slice(delimiterIndex + 2);
            }
        }

        socket.addListener("data", onHandshakeData);
        proposeAuth(socket, methods[0]);
    }

    static open(address: Address): Promise<Connection> {
        return new Promise((resolve, reject) => {
            const socket = createSocket(address);
            socket.once("error", reject);
            socket.once("connect", () => {
                Connection.handshake(socket, ["EXTERNAL", "ANONYMOUS"], resolve, reject);
                socket.removeListener("error", reject);
            });
        });
    }
}

export class Bus {
    constructor(private readonly connection: Connection) {
        // do nothing
    }

    introspect(path: string, service: string): Promise<IntrospectionResult> {
        const message = new MessageBuilder(MessageKind.Call);
        message.setHeader(Header.Interface, DataType.String, "org.freedesktop.DBus.Introspectable");
        message.setHeader(Header.Member, DataType.String, "Introspect");
        message.setHeader(Header.Destination, DataType.String, service);
        message.setHeader(Header.Path, DataType.ObjectPath, path);

        return this.invoke(message).then(reader => {
            reader.skipToBody();
            const xml = reader.readString();
            return IntrospectionResult.parse(xml);
        });
    }

    invoke(message: MessageBuilder): Promise<Reader> {
        return this.connection.sendAndReceive(message.build());
    }
}

export function sessionBus(): Promise<Bus> {
    const addressVar = process.env["DBUS_SESSION_BUS_ADDRESS"];
    if (!addressVar)
        throw new Error("DBus session address environment variable is unset");

    const address = parseAddress(addressVar);
    return Connection.open(address).then(v => new Bus(v));
}
