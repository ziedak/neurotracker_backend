# Infrastructure Verification Protocol

**Version**: 1.0.0  
**Created**: 2025-09-09  
**Compliance**: Constitutional Article II

## Mandatory Infrastructure Verification

Before creating any new patterns, systems, or architectural components, the following existing infrastructure MUST be verified and leveraged:

### Core Infrastructure Systems

#### ServiceRegistry Dependency Injection

**Location**: `@libs/config` and DI container implementations  
**Capabilities**: Sophisticated dual DI architecture with service lifecycle management

**Verification Requirements**:

- [ ] Read actual ServiceRegistry implementation code
- [ ] Verify service registration patterns in use
- [ ] Document existing service management capabilities
- [ ] Confirm DI container usage in target service area
- [ ] Test service resolution and lifecycle management

**Evidence**: Implementation files, service registration examples, DI configuration

#### CacheService Infrastructure

**Location**: `@libs/database` or cache management libraries  
**Capabilities**: Enterprise-grade caching with LRU, TTL, cleanup mechanisms

**Verification Requirements**:

- [ ] Read CacheService implementation details
- [ ] Verify cache strategies and eviction policies
- [ ] Document performance characteristics
- [ ] Confirm cache integration patterns
- [ ] Test cache operations and monitoring

**Evidence**: CacheService code, configuration files, performance metrics

#### PoolService Connection Management

**Location**: Database connection pooling implementations  
**Capabilities**: Connection pooling with health monitoring and resilience

**Verification Requirements**:

- [ ] Read PoolService implementation
- [ ] Verify connection lifecycle management
- [ ] Document pool configuration options
- [ ] Confirm health monitoring capabilities
- [ ] Test connection resilience patterns

**Evidence**: Pool configuration, health check implementations, connection code

#### Telemetry & Monitoring Systems

**Location**: `@libs/monitoring` comprehensive infrastructure  
**Capabilities**: Logging, metrics collection, health checks, request tracing

**Verification Requirements**:

- [ ] Read telemetry implementation architecture
- [ ] Verify metrics collection capabilities
- [ ] Document logging infrastructure
- [ ] Confirm health check patterns
- [ ] Test monitoring integration points

**Evidence**: Monitoring configurations, telemetry code, metrics dashboards

#### Database Client Infrastructure

**Location**: Redis, PostgreSQL, ClickHouse client implementations  
**Capabilities**: Enterprise database clients with resilience and monitoring

**Verification Requirements**:

- [ ] Read database client implementations
- [ ] Verify connection management and resilience
- [ ] Document query optimization patterns
- [ ] Confirm monitoring and health checks
- [ ] Test database operation patterns

**Evidence**: Database client code, connection configurations, query implementations

## Service-Specific Infrastructure

#### API Gateway Infrastructure

**Location**: `apps/api-gateway` (port 3000)  
**Capabilities**: WebSocket support, Swagger documentation, Authentication

**Verification Requirements**:

- [ ] Read API Gateway implementation
- [ ] Verify WebSocket handling capabilities
- [ ] Document authentication integration
- [ ] Confirm routing and middleware patterns
- [ ] Test gateway functionality

#### Elysia Server Infrastructure

**Location**: `@libs/elysia-server` shared server patterns  
**Capabilities**: Server creation patterns, WebSocket support, middleware integration

**Verification Requirements**:

- [ ] Read elysia-server implementation
- [ ] Verify server creation patterns
- [ ] Document middleware integration capabilities
- [ ] Confirm WebSocket support
- [ ] Test server configuration options

#### Authentication Infrastructure

**Location**: `@libs/auth` comprehensive authentication system  
**Capabilities**: JWT services, guards, Keycloak integration, threat detection

**Verification Requirements**:

- [ ] Read authentication service implementations
- [ ] Verify JWT handling and validation
- [ ] Document Keycloak integration patterns
- [ ] Confirm role-based access control
- [ ] Test authentication flows

## Verification Process

### Step 1: Infrastructure Discovery

1. **Identify Target Area**: Define the specific functionality being implemented
2. **Map Existing Systems**: Identify potentially relevant infrastructure
3. **Prioritize Verification**: Focus on most likely infrastructure matches
4. **Document Scope**: Define verification boundaries and expectations

### Step 2: Deep Implementation Analysis

1. **Read Source Code**: Study actual implementation files, not just interfaces
2. **Trace Execution Paths**: Follow code flows to understand capabilities
3. **Analyze Configurations**: Review configuration options and patterns
4. **Study Integration Points**: Understand how systems connect and interact
5. **Review Test Coverage**: Examine test suites for capability validation

### Step 3: Capability Documentation

1. **Document Features**: List verified capabilities with evidence
2. **Note Limitations**: Identify constraints and boundaries
3. **Record Patterns**: Document usage patterns and best practices
4. **Create Examples**: Provide concrete usage examples
5. **Assess Gaps**: Identify any gaps between needs and capabilities

### Step 4: Integration Planning

1. **Design Integration**: Plan how to leverage existing infrastructure
2. **Identify Extensions**: Determine any necessary extensions or configurations
3. **Plan Testing**: Design tests to verify integration works correctly
4. **Document Dependencies**: Record all infrastructure dependencies
5. **Create Migration Path**: Plan transition if replacing existing systems

### Step 5: Evidence Collection

1. **Code References**: Link to specific implementation files
2. **Configuration Examples**: Provide working configuration samples
3. **Test Results**: Include test output demonstrating capabilities
4. **Performance Data**: Collect performance metrics where relevant
5. **Documentation**: Create comprehensive usage documentation

## Anti-Patterns and Violations

### Constitutional Violations

- **Creating New Systems Without Verification**: Implementing new infrastructure without verifying existing capabilities
- **Duplicating Existing Functionality**: Building systems that replicate existing infrastructure
- **Ignoring Integration Patterns**: Failing to follow established integration approaches
- **Insufficient Evidence**: Documenting patterns without implementation verification
- **Assumption-Based Development**: Making assumptions about infrastructure without verification

### Warning Signs

- "I think the existing system can't handle..."
- "We need a new system because..."
- "The current implementation doesn't support..."
- "It would be easier to build from scratch..."
- "I don't have time to research the existing system..."

### Mandatory Justification Required

When existing infrastructure cannot meet requirements, provide:

1. **Detailed Verification Evidence**: Proof that existing systems were thoroughly analyzed
2. **Specific Limitation Documentation**: Precise technical limitations identified
3. **Alternative Analysis**: Other approaches considered and rejected
4. **Risk Assessment**: Risks of creating new systems vs. extending existing
5. **Architectural Review**: Approval from architecture team for new infrastructure

## Verification Templates

### Infrastructure Analysis Template

```markdown
## Infrastructure Verification: [System Name]

### Existing System Analysis

**Location**: [File paths and module locations]
**Last Verified**: [Date]
**Verifier**: [Team member]

### Capabilities Verified

- [Capability 1]: [Evidence and limitations]
- [Capability 2]: [Evidence and limitations]
- [Capability 3]: [Evidence and limitations]

### Integration Patterns

- [Pattern 1]: [Implementation approach]
- [Pattern 2]: [Implementation approach]

### Gaps Identified

- [Gap 1]: [Description and impact]
- [Gap 2]: [Description and impact]

### Recommendation

[Use existing / Extend existing / Create new with justification]

### Evidence Files

- [Link to implementation code]
- [Link to configuration examples]
- [Link to test results]
```

### New Infrastructure Justification Template

```markdown
## New Infrastructure Justification

### Existing System Verification

**System Analyzed**: [Infrastructure system]
**Verification Completed**: [Date]
**Evidence Location**: [Links to verification documentation]

### Specific Limitations

1. [Technical limitation with evidence]
2. [Performance constraint with measurements]
3. [Functional gap with requirements]

### Alternatives Considered

- **Extend Existing**: [Why not viable]
- **Configure Existing**: [Why insufficient]
- **Integrate Multiple Systems**: [Why not suitable]

### New System Requirements

- [Requirement 1]: [Justification]
- [Requirement 2]: [Justification]

### Risk Assessment

- **Development Risk**: [Assessment]
- **Maintenance Risk**: [Assessment]
- **Integration Risk**: [Assessment]

### Architectural Review

**Required**: Yes
**Reviewers**: [Architecture team members]
**Approval Status**: [Pending/Approved/Rejected]
```

## Continuous Improvement

### Verification Metrics

- Time spent on infrastructure verification vs. development
- Percentage of new systems that leverage existing infrastructure
- Number of duplicate systems prevented through verification
- Infrastructure utilization improvements over time

### Knowledge Base Evolution

- Regular updates to infrastructure capability documentation
- Improved verification templates based on lessons learned
- Enhanced automation of verification processes
- Better integration between verification and development workflows

---

**Constitutional Authority**: Article II - Infrastructure Verification First  
**Enforcement**: Mandatory for all development activities  
**Updates**: Quarterly review with architecture team
