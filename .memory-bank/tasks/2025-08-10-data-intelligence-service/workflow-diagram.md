# Workflow Diagram: Data Intelligence Service

```
[API Request]
     |
     v
[Feature Store Module] <--> [Redis]
     |
     v
[Analytics Module] <--> [ClickHouse]
     |
     v
[Compliance Module] <--> [PostgreSQL]
     |
     v
[Dashboard / Other Services]
```

- Feature requests flow through the Feature Store, using Redis for real-time data.
- Analytics requests are processed via ClickHouse.
- Compliance and data quality requests interact with PostgreSQL.
- All modules expose APIs for both backend services and dashboard.
