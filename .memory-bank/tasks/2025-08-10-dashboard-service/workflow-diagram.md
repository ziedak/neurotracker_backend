# Workflow Diagram: Dashboard Service

```
[API Request]
     |
     v
[Dashboard Service] <--> [Data Intelligence Service]
     |
     v
[API Gateway / Service Registry]
     |
     v
[Dashboard Frontend]
```

- Dashboard Service proxies/aggregates Data Intelligence APIs for dashboard use
- Registered in API Gateway and Service Registry
- Serves dashboard-specific endpoints and handles authentication
