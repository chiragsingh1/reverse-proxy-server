import http from "node:http";
import { ConfigSchemaType, rootConfigSchema } from "./config-schema";
import cluster, { Worker } from "node:cluster";
import {
    WorkerMessageSchemaType,
    workerMessageSchema,
    WorkerMessageReplySchemaType,
    workerMessageReplySchema,
} from "./server-schema";

interface CreateServerConfig {
    port: number;
    workerCount: number;
    config: ConfigSchemaType;
}

export async function createServer(
    createServerConfiguration: CreateServerConfig
) {
    const { workerCount, config, port } = createServerConfiguration;

    const WORKER_POOL: Worker[] = [];

    if (cluster.isPrimary) {
        console.log("Master Process is up 🚀");
        for (let i = 0; i < workerCount; i++) {
            const w = cluster.fork({ config: JSON.stringify(config) });
            WORKER_POOL.push(w);
            console.log(`Master Process: Worker Node spinned: ${i}`);
        }

        const server = http.createServer(function (req, res) {
            const index = Math.floor(Math.random() * WORKER_POOL.length);
            const worker = WORKER_POOL.at(index);

            if (!worker) throw new Error("Worker not found.");

            const payload: WorkerMessageSchemaType = {
                requestType: "HTTP",
                headers: req.headers,
                body: null,
                url: `${req.url}`,
            };
            worker.send(JSON.stringify(payload));

            // Listen
            worker.once("message", async (workerReply: string) => {
                const reply = await workerMessageReplySchema.parseAsync(
                    JSON.parse(workerReply)
                );

                if (reply.errorCode) {
                    res.writeHead(parseInt(reply.errorCode));
                    res.end(reply.error);
                } else {
                    res.writeHead(200);
                    res.end(reply.data);
                }
            });
            worker.once("error", (error) => {
                console.error("Worker error:", error);
                res.writeHead(500);
                res.end("Internal Server Error");
            });
        });

        server.listen(port, function () {
            console.log(`Reverse Proxy listening on port: ${port}`);
        });
    } else {
        console.log("Worker Node 🚀");

        const configuration = await rootConfigSchema.parseAsync(
            JSON.parse(`${process.env.config}`)
        );

        process.on("message", async (message: string) => {
            const messageValidated = await workerMessageSchema.parseAsync(
                JSON.parse(message)
            );
            // console.log(messageValidated);

            const requestURL = messageValidated.url;
            const rule = config.server.rules.find((e) => {
                const regex = new RegExp(`^${e.path}.*$`);
                return regex.test(requestURL);
            });

            if (!rule) {
                const reply: WorkerMessageReplySchemaType = {
                    errorCode: "404",
                    error: "Rule not found",
                };
                if (process.send) {
                    return process.send(JSON.stringify(reply));
                }
            }

            const upstreamID = rule?.upstreams[0];
            const upstream = config.server.upstreams.find(
                (u) => u.id === upstreamID
            );

            if (!upstream) {
                const reply: WorkerMessageReplySchemaType = {
                    errorCode: "500",
                    error: "Upstream server not found",
                };
                if (process.send) {
                    return process.send(JSON.stringify(reply));
                }
            }

            const request = http.request(
                {
                    host: upstream?.url,
                    path: requestURL,
                    method: "GET",
                },
                (proxyRes) => {
                    let body = "";

                    proxyRes.on("data", (chunk) => {
                        body += chunk;
                    });

                    proxyRes.on("end", () => {
                        const reply: WorkerMessageReplySchemaType = {
                            data: body,
                        };
                        if (process.send) {
                            return process.send(JSON.stringify(reply));
                        }
                    });
                }
            );
            request.end();
        });
    }
}
