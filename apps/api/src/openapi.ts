export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Reliable Notification Platform API",
    version: "1.0.0",
    description:
      "Production-shaped notification API with a transactional outbox, Redis Streams, idempotent workers, retries, scheduling, and signed provider webhooks. The hosted deployment is a demo: use only synthetic recipients and data."
  },
  servers: [{ url: "/", description: "Current host" }],
  tags: [
    { name: "Notifications", description: "Accept and inspect asynchronous notification delivery." },
    { name: "Users", description: "Tenant users and channel preferences." },
    { name: "Catalog", description: "Notification types and versioned templates." },
    { name: "Webhooks", description: "Signed callbacks from delivery providers." },
    { name: "Admin", description: "JWT-protected tenant and operational controls." },
    { name: "Operations", description: "Liveness, readiness, and metrics." }
  ],
  paths: {
    "/v1/notifications": {
      post: {
        tags: ["Notifications"],
        summary: "Accept a notification",
        description:
          "Returns 202 after the notification, idempotency record, and due outbox event commit. Provider delivery happens asynchronously.",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateNotification" } } }
        },
        responses: {
          "202": {
            description: "Accepted or idempotently replayed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AcceptedNotification" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" }
        }
      },
      get: {
        tags: ["Notifications"],
        summary: "List recent notifications",
        security: [{ tenantApiKey: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }
        ],
        responses: {
          "200": {
            description: "Recent notifications",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    notifications: {
                      type: "array",
                      items: { $ref: "#/components/schemas/NotificationSummary" }
                    }
                  }
                }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/v1/notifications/{id}": {
      get: {
        tags: ["Notifications"],
        summary: "Get notification status",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/NotificationId" }],
        responses: {
          "200": {
            description: "Notification",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Notification" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/notifications/{id}/trace": {
      get: {
        tags: ["Notifications"],
        summary: "Trace the complete pipeline",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/NotificationId" }],
        responses: {
          "200": {
            description: "Notification, outbox, delivery attempts, audit events, and webhooks",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/notifications/{id}/attempts": {
      get: {
        tags: ["Notifications"],
        summary: "List delivery attempts",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/NotificationId" }],
        responses: {
          "200": {
            description: "Delivery attempts",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
          }
        }
      }
    },
    "/v1/users": {
      post: {
        tags: ["Users"],
        summary: "Create or update a tenant user",
        security: [{ tenantApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertUser" } } }
        },
        responses: {
          "201": { description: "User created or updated" },
          "400": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/v1/users/{externalId}": {
      get: {
        tags: ["Users"],
        summary: "Get a tenant user",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/ExternalUserId" }],
        responses: {
          "200": { description: "User" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/users/{externalId}/preferences": {
      get: {
        tags: ["Users"],
        summary: "List notification preferences",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/ExternalUserId" }],
        responses: { "200": { description: "Preferences" } }
      },
      put: {
        tags: ["Users"],
        summary: "Set a notification preference",
        security: [{ tenantApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/ExternalUserId" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Preference" } } }
        },
        responses: {
          "200": { description: "Preference saved" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/catalog/types": {
      get: {
        tags: ["Catalog"],
        summary: "List notification types",
        security: [{ tenantApiKey: [] }],
        responses: { "200": { description: "Notification types" } }
      },
      post: {
        tags: ["Catalog"],
        summary: "Create or update a notification type",
        security: [{ tenantApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationType" } } }
        },
        responses: { "201": { description: "Type saved" } }
      }
    },
    "/v1/catalog/templates": {
      get: {
        tags: ["Catalog"],
        summary: "List published templates",
        security: [{ tenantApiKey: [] }],
        responses: { "200": { description: "Published templates" } }
      },
      post: {
        tags: ["Catalog"],
        summary: "Publish a new template version",
        security: [{ tenantApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Template" } } }
        },
        responses: { "201": { description: "Template version published" } }
      }
    },
    "/v1/webhooks/{provider}": {
      post: {
        tags: ["Webhooks"],
        summary: "Process a provider delivery event",
        description:
          "The provider signs `timestamp + '.' + rawBody` with HMAC-SHA256. Event IDs are idempotent per provider.",
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["email", "sms", "push"] }
          },
          { name: "x-provider-timestamp", in: "header", required: true, schema: { type: "string" } },
          { name: "x-provider-signature", in: "header", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookEvent" } } }
        },
        responses: {
          "200": { description: "Processed or duplicate event" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/admin/login": {
      post: {
        tags: ["Admin"],
        summary: "Exchange admin credentials for a JWT",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "JWT and expiry" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/admin/tenants": {
      get: {
        tags: ["Admin"],
        summary: "List tenants",
        security: [{ adminJwt: [] }],
        responses: { "200": { description: "Tenants" } }
      },
      post: {
        tags: ["Admin"],
        summary: "Create a tenant",
        security: [{ adminJwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "slug"],
                properties: { name: { type: "string" }, slug: { type: "string" } }
              }
            }
          }
        },
        responses: { "201": { description: "Tenant created" } }
      }
    },
    "/admin/queue/stats": {
      get: {
        tags: ["Admin"],
        summary: "Read Redis Stream and scheduler counts",
        security: [{ adminJwt: [] }],
        responses: { "200": { description: "Queue statistics" } }
      }
    },
    "/admin/outbox/stats": {
      get: {
        tags: ["Admin"],
        summary: "Read outbox counts by status",
        security: [{ adminJwt: [] }],
        responses: { "200": { description: "Outbox statistics" } }
      }
    },
    "/admin/outbox/replay-stuck": {
      post: {
        tags: ["Admin"],
        summary: "Re-enqueue notifications stuck for more than two minutes",
        security: [{ adminJwt: [] }],
        responses: { "200": { description: "Candidate and enqueue counts" } }
      }
    },
    "/v1/demo/stats": {
      get: {
        tags: ["Operations"],
        summary: "Read safe queue and outbox statistics for the demo console",
        description: "Available only when DEMO_MODE is enabled. It exposes counts, never credentials or message bodies.",
        responses: {
          "200": { description: "Queue and outbox counts" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/health/live": {
      get: {
        tags: ["Operations"],
        summary: "Process liveness",
        responses: { "200": { description: "Process is alive" } }
      }
    },
    "/health/ready": {
      get: {
        tags: ["Operations"],
        summary: "Postgres and Redis readiness",
        responses: {
          "200": { description: "Dependencies are ready" },
          "503": { description: "A dependency is unavailable" }
        }
      }
    },
    "/metrics": {
      get: {
        tags: ["Operations"],
        summary: "Prometheus metrics",
        responses: {
          "200": {
            description: "Prometheus exposition format",
            content: { "text/plain": { schema: { type: "string" } } }
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      tenantApiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      adminJwt: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1 },
        description: "A stable key for replay-safe acceptance."
      },
      NotificationId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" }
      },
      ExternalUserId: {
        name: "externalId",
        in: "path",
        required: true,
        schema: { type: "string" }
      }
    },
    schemas: {
      CreateNotification: {
        type: "object",
        required: ["userId", "type", "channel"],
        properties: {
          userId: { type: "string", example: "user-1" },
          type: { type: "string", example: "order.shipped" },
          channel: { type: "string", enum: ["email", "sms", "push"] },
          payload: {
            type: "object",
            additionalProperties: true,
            example: { name: "Ada", orderId: "A-1042" }
          },
          sendAt: { type: "string", format: "date-time" }
        }
      },
      AcceptedNotification: {
        type: "object",
        required: ["id", "status", "sendAt", "scheduled", "replay"],
        properties: {
          id: { type: "string", format: "uuid" },
          status: { $ref: "#/components/schemas/NotificationStatus" },
          sendAt: { type: "string", format: "date-time" },
          scheduled: { type: "boolean" },
          replay: { type: "boolean" }
        }
      },
      NotificationStatus: {
        type: "string",
        enum: ["pending", "queued", "processing", "submitted", "retrying", "delivered", "dead", "cancelled"]
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          status: { $ref: "#/components/schemas/NotificationStatus" },
          channel: { type: "string", enum: ["email", "sms", "push"] },
          attempt_count: { type: "integer" },
          max_attempts: { type: "integer" },
          send_at: { type: "string", format: "date-time" },
          next_attempt_at: { type: ["string", "null"], format: "date-time" },
          provider_message_id: { type: ["string", "null"] },
          last_error_code: { type: ["string", "null"] },
          last_error_class: { type: ["string", "null"] }
        }
      },
      NotificationSummary: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          status: { $ref: "#/components/schemas/NotificationStatus" },
          channel: { type: "string" },
          attempt_count: { type: "integer" },
          type_key: { type: "string" }
        }
      },
      UpsertUser: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          pushToken: { type: "string" }
        }
      },
      Preference: {
        type: "object",
        required: ["type", "channel", "optedIn"],
        properties: {
          type: { type: "string" },
          channel: { type: "string", enum: ["email", "sms", "push"] },
          optedIn: { type: "boolean" }
        }
      },
      NotificationType: {
        type: "object",
        required: ["key", "name"],
        properties: {
          key: { type: "string" },
          name: { type: "string" },
          category: { type: "string", enum: ["transactional", "marketing"], default: "transactional" }
        }
      },
      Template: {
        type: "object",
        required: ["type", "channel", "name", "body"],
        properties: {
          type: { type: "string" },
          channel: { type: "string", enum: ["email", "sms", "push"] },
          name: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" }
        }
      },
      WebhookEvent: {
        type: "object",
        required: ["eventId", "eventType", "provider", "notificationId", "providerMessageId"],
        properties: {
          eventId: { type: "string" },
          eventType: { type: "string", enum: ["delivered", "bounced", "failed"] },
          provider: { type: "string", enum: ["email", "sms", "push"] },
          notificationId: { type: "string", format: "uuid" },
          providerMessageId: { type: "string" }
        }
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" }
            }
          }
        }
      }
    },
    responses: {
      BadRequest: {
        description: "Validation or malformed request",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Unauthorized: {
        description: "Missing or invalid credentials",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      RateLimited: {
        description: "Rate limit exceeded",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  }
} as const;
