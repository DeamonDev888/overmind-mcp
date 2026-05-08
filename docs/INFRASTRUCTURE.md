# Infrastructure

## Variables d'environnement

| Variable                      | Valeur     | Description                                       |
| ----------------------------- | ---------- | ------------------------------------------------- |
| `OTEL_ENABLED`                | `true`     | Active OpenTelemetry (désactivé par défaut)       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL        | Endpoint OTLP (défaut: localhost:4318)            |
| `OVERMIND_BROKER`             | `rabbitmq` | Active le broker RabbitMQ (désactivé par défaut)  |
| `RABBITMQ_URL`                | URL        | URL connexion RabbitMQ (défaut: amqp://localhost) |
| `OVERMIND_WORKFLOW`           | `temporal` | Active Temporal workflow (désactivé par défaut)   |
| `TEMPORAL_ADDRESS`            | host:port  | Adresse Temporal (défaut: localhost:7233)         |

## Docker one-liners

```bash
# RabbitMQ
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# Temporal (dev mode)
docker run -d --name temporal -p 7233:7233 -p 8233:8233 temporalio/auto-setup:1.22.0

# Jaeger + OTel Collector
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:1.52
```

## Note

Par défaut, tout est désactivé (V1.x backward-compatible).
Activez les vars uniquement si vous avez l'infra得当 en place.
