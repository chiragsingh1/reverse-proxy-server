### Building a Scalable Reverse Proxy Server with Node.js Clusters and TypeScript like Nginx

In today's microservices architecture, reverse proxies play a crucial role in managing and routing incoming requests to various backend services. Let's explore how to build a basic, robust and scalable reverse proxy server using Node.js and TypeScript, complete with configuration management and multi-process support.

#### The Inspiration

Modern web applications often consist of multiple services running on different servers. Managing these services and ensuring efficient request routing can become complex. A reverse proxy serves as a central point of control, handling tasks like:

- Load balancing across multiple upstream servers
- Request routing based on URL patterns
- Header manipulation and request transformation
- Response caching and compression

While there are excellent solutions like Nginx and HAProxy available, building a custom reverse proxy will allows us to understand the underlying concepts better and tailor the functionality to specific needs.

The goal of this project was to:
1. Understand the fundamentals of reverse proxying.
2. Implement scalable server architectures using worker processes.
3. Validate configurations to ensure reliability.
4. Utilize modern TypeScript features for type safety and maintainability.

#### Project Architecture

Our reverse proxy implementation follows these key design principles:

1. **Configuration-Driven**: All proxy behavior is defined in a YAML configuration file, making it easy to modify routing rules without changing code.
2. **Type Safety**: TypeScript and Zod schemas ensure configuration validity and runtime type safety.
3. **Scalability**: Node.js cluster module enables utilizing multiple CPU cores for better performance.
4. **Modularity**: Clear separation of concerns with distinct modules for configuration, server logic, and schema validation.

#### Project Structure

├── config.yaml           # Server configuration
├── src/
│   ├── config-schema.ts  # Configuration validation schemas
│   ├── config.ts         # Configuration parsing logic
│   ├── index.ts         # Application entry point
│   ├── server-schema.ts # Server message schemas
│   └── server.ts        # Core server implementation
└── tsconfig.json        # TypeScript configuration

#### Key Components

1. **config.yaml**: Defines the server's configuration, including the port, worker processes, upstream servers, headers, and routing rules.
2. **config-schema.ts**: Defines validation schemas using the Zod library to ensure the configuration structure is correct.
3. **server-schema.ts**: Specifies message formats exchanged between the master and worker processes.
4. **config.ts**: Provides functions for parsing and validating the YAML configuration file.
5. **server.ts**: Implements the reverse proxy server logic, including cluster setup, HTTP handling, and request forwarding.
6. **index.ts**: Serves as the entry point, parsing command-line options and initiating the server.

### Implementation Deep Dive

#### Configuration Management

The configuration system uses YAML for its human-readable format and strong support for complex data structures. Here's how it works:

```yaml
server:
    listen: 8080
    workers: 2
    upstreams:
        - id: jsonplaceholder
          url: jsonplaceholder.typicode.com
        - id: dummy
          url: dummyjson.com
    headers:
        - key: x-forward-for
          value: $ip
        - key: Authorization
          value: Bearer xyz
    rules:
        - path: /test
          upstreams:
              - dummy
        - path: /
          upstreams:
              - jsonplaceholder
```

#### Configuration Validation (config-schema.ts)
We use Zod to define strict schemas for configuration validation:

```typescript
import { z } from "zod";

const upstreamSchema = z.object({
    id: z.string(),
    url: z.string(),
});

const headerSchema = z.object({
    key: z.string(),
    value: z.string(),
});

const ruleSchema = z.object({
    path: z.string(),
    upstreams: z.array(z.string()),
});

const serverSchema = z.object({
    listen: z.number(),
    workers: z.number().optional(),
    upstreams: z.array(upstreamSchema),
    headers: z.array(headerSchema).optional(),
    rules: z.array(ruleSchema),
});

export const rootConfigSchema = z.object({
    server: serverSchema,
});

export type ConfigSchemaType = z.infer<typeof rootConfigSchema>;
```

This schema-first approach provides several benefits:
- Runtime type safety
- Automatic TypeScript type generation
- Clear validation errors for misconfigurations
- Self-documenting configuration structure

#### Parsing and Validating Configurations (config.ts)

The config.ts module provides utility functions to parse and validate the configuration file.

```typescript
import fs from "node:fs/promises";
import { parse } from "yaml";
import { rootConfigSchema } from "./config-schema";

export async function parseYAMLConfig(filepath: string) {
    const configFileContent = await fs.readFile(filepath, "utf8");
    const configParsed = parse(configFileContent);
    return JSON.stringify(configParsed);
}

export async function validateConfig(config: string) {
    const validatedConfig = await rootConfigSchema.parseAsync(
        JSON.parse(config)
    );
    return validatedConfig;
}
```
### Reverse Proxy Server Logic (server.ts)

The server utilizes the Node.js cluster module for scalability and the http module for handling requests. The master process distributes requests to worker processes, which forwards them to upstream servers. Let's explore the server.ts file in detail, which contains the core logic of our reverse proxy server. We'll break down each component and understand how they work together to create a scalable proxy server. 
The server implementation follows a master-worker architecture using **Node.js's cluster** module. This design allows us to:
- Utilize multiple CPU cores
- Handle requests concurrently
- Maintain high availability
- Isolate request processing

1. **Master Process**: 
   - Creates worker processes
   - Distributes incoming requests across workers
   - Manages the worker pool
   - Handles worker crashes and restarts

2. **Worker Processes**:
   - Handle individual HTTP requests
   - Match requests against routing rules
   - Forward requests to upstream servers
   - Process responses and send them back to clients

Let's examine each part of the implementation in detail.

#### Master Process Setup
```typescript
if (cluster.isPrimary) {
    console.log("Master Process is up 🚀");
    for (let i = 0; i < workerCount; i++) {
        const w = cluster.fork({ config: JSON.stringify(config) });
        WORKER_POOL.push(w);
        console.log(Master Process: Worker Node spinned: ${i});
    }

    const server = http.createServer((req, res) => {
        const index = Math.floor(Math.random() * WORKER_POOL.length);
        const worker = WORKER_POOL.at(index);

        if (!worker) throw new Error("Worker not found.");

        const payload: WorkerMessageSchemaType = {
            requestType: "HTTP",
            headers: req.headers,
            body: null,
            url: ${req.url},
        };
        worker.send(JSON.stringify(payload));

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
    });

    server.listen(port, () => {
        console.log(Reverse Proxy listening on port: ${port});
    });
}
```
The master process creates a pool of workers and passes the configuration to each worker through environment variables. This ensures all workers have access to the same configuration.

#### Request Distribution

```typescript
const server = http.createServer(function (req, res) {
    const index = Math.floor(Math.random() * WORKER_POOL.length);
    const worker = WORKER_POOL.at(index);
    
    const payload: WorkerMessageSchemaType = {
        requestType: "HTTP",
        headers: req.headers,
        body: null,
        url: ${req.url},
    };
    worker.send(JSON.stringify(payload));
});
```
The master process uses a simple random distribution strategy to assign requests to workers. While not as sophisticated as round-robin or least-connections algorithms, this approach provides decent load distribution for most use cases. The request distribution logic:
- Randomly selects a worker from the pool
- Creates a balanced workload across workers
- Handles edge cases where workers might be unavailable

#### Worker Process Request Logic

Each worker listens for messages, matches requests against routing rules, and forwards them to the appropriate upstream server. 

```typescript
process.on("message", async (message: string) => {
    const messageValidated = await workerMessageSchema.parseAsync(
        JSON.parse(message)
    );

    const requestURL = messageValidated.url;
    const rule = config.server.rules.find((e) => {
        const regex = new RegExp(^${e.path}.*$);
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
    const upstream = config.server.upstreams.find((u) => u.id === upstreamID);

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
```

The master process communicates with workers by constructing a standardized message payload, including all necessary request information, using Node.js IPC (Inter-Process Communication) and validating message structure using Zod schemas.

Workers handle the actual request processing and proxying. Each worker:

- Loads its configuration from environment variables
- Validates the configuration using Zod schemas
- Maintains its own copy of the configuration
Workers select upstream servers by:

- Finding the appropriate upstream ID from the rule
- Locating the upstream server configuration
- Validating the upstream server exists

The request forwarding mechanism:

- Creates a new HTTP request to the upstream server
- Streams the response data
- Aggregates the response body
- Sends the response back to the master process

#### Running the Server

To run the server, follow these steps:

1. **Build the project:**
   
```bash
   npm run build
```

2. **Start the server:**
   
```bash
   npm start -- --config config.yaml
```

3. **Development mode:**
   
```bash
   npm run dev
```

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/4rw8jh1ei69r8kmtpxvy.png)

In the above screenshot, we can see that there is 1 Master Node running and 2 Worker Processes are running. Our reverse proxy server is listening on port 8080.
In the config.yaml file, we describe two upstream servers namely: `jsonplaceholder` and `dummy`. If we want all requests coming to our server to be routed to `jsonplaceholder`, we put the rule as: 
```yaml
- path: /
  upstreams:
  - jsonplaceholder
```
Similarly, if we want our request to the `/test` endpoint should route to our `dummy` upstream server, we put the rule as:
```yaml
- path: /test
  upstreams:
  - dummy
```
Let's test this out! 

![Screenshot 1](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/r5smrshbz785l727efc5.png)

Wow, that is cool! We are navigating to `localhost:8080` but in response we can see we received the homepage for `jsonplaceholder.typicode.com`. The end user does not even know that we are seeing response from a separate server. That is why Reverse Proxy servers are important. If we have multiple servers running the same code and don't want to expose all of their ports to end users, use a reverse proxy as an abstraction layer. Users will hit the reverse proxy server, a very robust and quick server, and the reverse proxy server will determine which server to hit. 

Let's hit `localhost:8080/todos` now and see what happens.

![Screenshot 2](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/v6llqhnmgnepdnsg4k6a.png)

Our request got reverse proxied to the `jsonplaceholder` server again and received a JSON response from the resolved URL: `jsonplaceholder.typicode.com/todos`.


#### Error Handling and Type Safety

The implementation includes comprehensive error handling:

1. **Configuration Validation**: Zod schemas ensure configuration errors are caught early.
2. **Worker Process Errors**: The master process handles worker crashes and can restart failed workers.
3. **Request Processing Errors**: Workers properly handle and report upstream server errors.
4. **Type Safety**: TypeScript and Zod provide end-to-end type safety for all messages between processes.

#### Communication Flow
Let's visualize the complete request flow:

Client sends request → Master Process
Master Process → Selected Worker
Worker → Upstream Server
Upstream Server → Worker
Worker → Master Process
Master Process → Client

#### Performance Considerations

The multi-process architecture provides several performance benefits:

1. **CPU Utilization**: Worker processes can run on different CPU cores, utilizing available hardware resources.
2. **Process Isolation**: A crash in one worker doesn't affect others, improving reliability.
3. **Load Distribution**: Random distribution of requests helps prevent any single worker from becoming overwhelmed.

#### Future Improvements

While functional, the current implementation could be enhanced with:

1. **Better Load Balancing**: Implement more sophisticated algorithms like round-robin or least-connections.
2. **Health Checks**: Add periodic health checks for upstream servers.
3. **Caching**: Implement response caching to reduce upstream server load.
4. **Metrics**: Add prometheus-style metrics for monitoring.
5. **WebSocket Support**: Extend the proxy to handle WebSocket connections.
6. **HTTPS Support**: Add SSL/TLS termination capabilities.

### Conclusion

Building a reverse proxy server from scratch provides valuable insights into web architecture and Node.js server design. The combination of TypeScript and Zod creates a robust foundation for configuration management, while the cluster module enables scalable request handling.

This implementation demonstrates how modern JavaScript tools and practices can be used to build production-grade infrastructure components. Whether used as a learning tool or as a base for a custom proxy solution, the code provides a solid foundation for further development.
