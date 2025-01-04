### Building a Scalable Reverse Proxy Server with Node.js Clusters and TypeScript like Nginx

#### The Inspiration
In today's microservices architecture, reverse proxies play a crucial role in managing and routing incoming requests to various backend services. 

![Reverse Proxy](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/b2eup696gpymbppwirkj.png)

A reverse proxy sits in front of the web servers of an application and intercepts the requests coming from the client machines. This has a lot of benefits such as load balancing, hidden origin servers IP addresses leading to better security, caching, rate limiting, etc. 

In a distributed and microservice architecture, a single entry point is necessary. Reverse Proxy servers like Nginx helps in such scenarios. If we have multiple instances of our server running, managing and ensuring efficient request routing becomes tricky. A reverse proxy like Nginx is a perfect solution in this case. We can point our domain to the IP Address of the Nginx server and the Nginx will route the incoming request according to the configuration to one of the instances while taking care of the load being handled by each.

#### How Nginx does it so good?
I will recommend reading through this article from Nginx which explains in detail how Nginx is able to support huge scale of requests with super reliability and speed: [Nginx Architecture](https://blog.nginx.org/blog/inside-nginx-how-we-designed-for-performance-scale)

In short, Nginx has a Master process and a bunch of worker processes. It also has helper processes like Cache Loader and Cache Manager. The master and the worker process do all the heavy work.

- **Master Process**: Manages configuration and spawns child processes.
- **Cache Loader/Manager**: Handle cache loading and pruning with minimal resources.
- **Worker Processes**: Manage connections, disk I/O, and upstream communication, running nonblocking and independently.

Worker processes handle multiple connections nonblocking, reducing context switches. They are single-threaded, run independently, and use shared memory for shared resources like cache and session data. This architecture helps Nginx to reduce the number of context switches and increase the speed faster than a blocking, multi process architecture.

Taking inspiration from this, we will use the same concept of master and worker process and will implement our own **event-driven reverse proxy server** which will be able to handle thousands of connection per worker process.

#### Project Architecture

Our reverse proxy implementation follows these key design principles:

1. **Configuration-Driven**: All proxy behavior is defined in a YAML configuration file, making it easy to modify routing rules.
2. **Type Safety**: TypeScript and Zod schemas ensure configuration validity and runtime type safety.
3. **Scalability**: Node.js cluster module enables utilizing multiple CPU cores for better performance.
4. **Modularity**: Clear separation of concerns with distinct modules for configuration, server logic, and schema validation.

#### Project Structure
```
├── config.yaml           # Server configuration
├── src/
│   ├── config-schema.ts  # Configuration validation schemas
│   ├── config.ts         # Configuration parsing logic
│   ├── index.ts         # Application entry point
│   ├── server-schema.ts # Server message schemas
│   └── server.ts        # Core server implementation
└── tsconfig.json        # TypeScript configuration
```
#### Key Components

1. **config.yaml**: Defines the server's configuration, including the port, worker processes, upstream servers, headers, and routing rules.
2. **config-schema.ts**: Defines validation schemas using the Zod library to ensure the configuration structure is correct.
3. **server-schema.ts**: Specifies message formats exchanged between the master and worker processes.
4. **config.ts**: Provides functions for parsing and validating the YAML configuration file.
5. **server.ts**: Implements the reverse proxy server logic, including cluster setup, HTTP handling, and request forwarding.
6. **index.ts**: Serves as the entry point, parsing command-line options and initiating the server.

#### Configuration Management

The configuration system uses YAML. Here's how it works:

```yaml
server:
    listen: 8080          # Port the server listens on.
    workers: 2            # Number of worker processes to handle requests.
    upstreams:            # Define upstream servers (backend targets).
        - id: jsonplaceholder
          url: jsonplaceholder.typicode.com
        - id: dummy
          url: dummyjson.com
    headers:              # Custom headers added to proxied requests.
        - key: x-forward-for
          value: $ip      # Adds the client IP to the forwarded request.
        - key: Authorization
          value: Bearer xyz  # Adds an authorization token to requests.
    rules:                # Define routing rules for incoming requests.
        - path: /test
          upstreams:
              - dummy     # Routes requests to "/test" to the "dummy" upstream.
        - path: /
          upstreams:
              - jsonplaceholder  # Routes all other requests to "jsonplaceholder".

```
Incoming requests are evaluated against the rules. Based on the path, the reverse proxy determines which upstream server to forward the request to.

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

![Screenshot1](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/4rw8jh1ei69r8kmtpxvy.png)

In the above screenshot, we can see that there is 1 Master Node and 2 Worker Processes are running. Our reverse proxy server is listening on port 8080.
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

![Screenshot2](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/r5smrshbz785l727efc5.png)

Wow, that is cool! We are navigating to `localhost:8080` but in response we can see we received the homepage for `jsonplaceholder.typicode.com`. The end user does not even know that we are seeing response from a separate server. That is why Reverse Proxy servers are important. If we have multiple servers running the same code and don't want to expose all of their ports to end users, use a reverse proxy as an abstraction layer. Users will hit the reverse proxy server, a very robust and quick server, and it will determine which server to route request to. 

Let's hit `localhost:8080/todos` now and see what happens.

![Screenshot3](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/v6llqhnmgnepdnsg4k6a.png)

Our request got reverse proxied to the `jsonplaceholder` server again and received a JSON response from the resolved URL: `jsonplaceholder.typicode.com/todos`.

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

### Wrapping Up

Building a reverse proxy server from scratch might seem intimidating at first, but as we’ve explored, it’s a rewarding experience. By combining Node.js clusters, TypeScript, and YAML-based configuration management, we’ve created a scalable and efficient system inspired by Nginx. 

There’s still room to enhance this implementation — better load balancing, caching, or WebSocket support are just a few ideas to explore. But the current design sets a strong foundation for experimenting and scaling further. If you’ve followed along, you’re now equipped to dive deeper into reverse proxies or even start building custom solutions tailored to your needs.

If you’d like to connect or see more of my work, check out my [GitHub](github.com/chiragsingh1), [LinkedIn](www.linkedin.com/in/chiragsingh2717).
The repository for this project can be found [here](https://github.com/chiragsingh1/reverse-proxy-server).

I’d love to hear your thoughts, feedback, or ideas for improvement. Thanks for reading, and happy coding! 🚀
