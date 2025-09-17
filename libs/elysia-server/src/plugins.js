import { swagger } from "@elysiajs/swagger";
export function setupCorePlugins(app, config) {
    // Swagger must be first
    if (config.swagger?.enabled) {
        app.use(swagger({
            path: config.swagger.path || "/swagger",
            documentation: {
                info: {
                    title: config.swagger.title || config.name,
                    version: config.swagger.version || config.version,
                    description: config.swagger.description ?? config.description ?? "",
                },
            },
        }));
    }
    return app;
}
//# sourceMappingURL=plugins.js.map