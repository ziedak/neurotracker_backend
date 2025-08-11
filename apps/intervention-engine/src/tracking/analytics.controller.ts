import { Elysia, t } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { AnalyticsService } from "./analytics.service";

export const createAnalyticsController = (
  analyticsService: AnalyticsService,
  logger: Logger,
  metrics: MetricsCollector
) => {
  return (
    new Elysia({ prefix: "/api/analytics" })

      // Get conversion rate for a campaign
      .get(
        "/conversion-rate/:campaignId",
        async ({ params, query, set }: any) => {
          try {
            const { campaignId } = params;
            const { storeId, startDate, endDate } = query;

            if (!storeId) {
              set.status = 400;
              return {
                success: false,
                error: "storeId is required",
              };
            }

            const start = startDate
              ? new Date(startDate)
              : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const end = endDate ? new Date(endDate) : new Date();

            const conversionRate =
              await analyticsService.calculateConversionRate(
                campaignId,
                storeId,
                { start, end }
              );

            return {
              success: true,
              data: {
                campaignId,
                storeId,
                timeframe: { start, end },
                conversionRate: Math.round(conversionRate * 100) / 100, // Round to 2 decimals
              },
            };
          } catch (error) {
            logger.error("Failed to get conversion rate", error as Error);
            set.status = 500;
            return {
              success: false,
              error: "Failed to get conversion rate",
              message: (error as Error).message,
            };
          }
        }
      )

      // Get ROI for a campaign
      .get("/roi/:campaignId", async ({ params, query, set }: any) => {
        try {
          const { campaignId } = params;
          const { storeId, startDate, endDate } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const end = endDate ? new Date(endDate) : new Date();

          const roi = await analyticsService.calculateROI(campaignId, storeId, {
            start,
            end,
          });

          return {
            success: true,
            data: {
              campaignId,
              storeId,
              timeframe: { start, end },
              roi: Math.round(roi * 100) / 100, // Round to 2 decimals
            },
          };
        } catch (error) {
          logger.error("Failed to get ROI", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get ROI",
            message: (error as Error).message,
          };
        }
      })

      // Get channel performance comparison
      .get("/channels/performance", async ({ query, set }: any) => {
        try {
          const { storeId, startDate, endDate } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const end = endDate ? new Date(endDate) : new Date();

          const channelPerformance =
            await analyticsService.getChannelPerformance(storeId, {
              start,
              end,
            });

          // Sort by conversion rate descending
          channelPerformance.sort(
            (a, b) => b.conversionRate - a.conversionRate
          );

          return {
            success: true,
            data: {
              storeId,
              timeframe: { start, end },
              channels: channelPerformance,
              summary: {
                bestPerformingChannel: channelPerformance[0]?.channel || "none",
                totalRevenue: channelPerformance.reduce(
                  (sum, ch) => sum + ch.revenue,
                  0
                ),
                totalConversions: channelPerformance.reduce(
                  (sum, ch) => sum + ch.conversions,
                  0
                ),
                averageConversionRate:
                  channelPerformance.reduce(
                    (sum, ch) => sum + ch.conversionRate,
                    0
                  ) / channelPerformance.length,
              },
            },
          };
        } catch (error) {
          logger.error("Failed to get channel performance", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get channel performance",
            message: (error as Error).message,
          };
        }
      })

      // Get funnel analysis for a campaign
      .get("/funnel/:campaignId", async ({ params, query, set }: any) => {
        try {
          const { campaignId } = params;
          const { storeId } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const funnelSteps = await analyticsService.getFunnelAnalysis(
            campaignId,
            storeId
          );

          // Calculate overall funnel efficiency
          const firstStep = funnelSteps[0];
          const lastStep = funnelSteps[funnelSteps.length - 1];
          const overallConversionRate =
            firstStep && firstStep.users > 0
              ? (lastStep.users / firstStep.users) * 100
              : 0;

          return {
            success: true,
            data: {
              campaignId,
              storeId,
              steps: funnelSteps,
              summary: {
                totalUsers: firstStep?.users || 0,
                finalConversions: lastStep?.users || 0,
                overallConversionRate:
                  Math.round(overallConversionRate * 100) / 100,
                biggestDropoff: findBiggestDropoff(funnelSteps),
              },
            },
          };
        } catch (error) {
          logger.error("Failed to get funnel analysis", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get funnel analysis",
            message: (error as Error).message,
          };
        }
      })

      // Get AB test results
      .get("/abtest/:testId", async ({ params, query, set }: any) => {
        try {
          const { testId } = params;
          const { storeId } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const results = await analyticsService.getABTestResults(
            testId,
            storeId
          );

          return {
            success: true,
            data: results,
          };
        } catch (error) {
          logger.error("Failed to get AB test results", error as Error);

          if ((error as Error).message.includes("not found")) {
            set.status = 404;
            return {
              success: false,
              error: "AB test not found",
            };
          }

          set.status = 500;
          return {
            success: false,
            error: "Failed to get AB test results",
            message: (error as Error).message,
          };
        }
      })

      // Get cohort analysis
      .get("/cohorts", async ({ query, set }: any) => {
        try {
          const { storeId, startDate, endDate } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
          const end = endDate ? new Date(endDate) : new Date();

          const cohortAnalysis = await analyticsService.getCohortAnalysis(
            storeId,
            { start, end }
          );

          return {
            success: true,
            data: {
              storeId,
              timeframe: { start, end },
              ...cohortAnalysis,
            },
          };
        } catch (error) {
          logger.error("Failed to get cohort analysis", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get cohort analysis",
            message: (error as Error).message,
          };
        }
      })

      // Get comprehensive dashboard data
      .get("/dashboard", async ({ query, set }: any) => {
        try {
          const { storeId, campaignId, startDate, endDate } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const end = endDate ? new Date(endDate) : new Date();

          // Get multiple analytics in parallel
          const [channelPerformance] = await Promise.all([
            analyticsService.getChannelPerformance(storeId, { start, end }),
          ]);

          // If campaign specified, get campaign-specific metrics
          let campaignMetrics = null;
          if (campaignId) {
            try {
              const [conversionRate, roi, funnelSteps] = await Promise.all([
                analyticsService.calculateConversionRate(campaignId, storeId, {
                  start,
                  end,
                }),
                analyticsService.calculateROI(campaignId, storeId, {
                  start,
                  end,
                }),
                analyticsService.getFunnelAnalysis(campaignId, storeId),
              ]);

              campaignMetrics = {
                campaignId,
                conversionRate: Math.round(conversionRate * 100) / 100,
                roi: Math.round(roi * 100) / 100,
                funnelSteps,
              };
            } catch (error) {
              logger.warn(
                "Failed to get campaign metrics for dashboard",
                error as Error
              );
            }
          }

          return {
            success: true,
            data: {
              storeId,
              timeframe: { start, end },
              channels: channelPerformance,
              campaign: campaignMetrics,
              summary: {
                totalRevenue: channelPerformance.reduce(
                  (sum, ch) => sum + ch.revenue,
                  0
                ),
                totalConversions: channelPerformance.reduce(
                  (sum, ch) => sum + ch.conversions,
                  0
                ),
                totalImpressions: channelPerformance.reduce(
                  (sum, ch) => sum + ch.impressions,
                  0
                ),
                averageConversionRate:
                  channelPerformance.reduce(
                    (sum, ch) => sum + ch.conversionRate,
                    0
                  ) / channelPerformance.length || 0,
                bestChannel:
                  channelPerformance.sort(
                    (a, b) => b.conversionRate - a.conversionRate
                  )[0]?.channel || "none",
              },
            },
          };
        } catch (error) {
          logger.error("Failed to get dashboard data", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get dashboard data",
            message: (error as Error).message,
          };
        }
      })

      // Export analytics data (CSV format)
      .get("/export", async ({ query, set }: any) => {
        try {
          const { storeId, type, startDate, endDate } = query;

          if (!storeId || !type) {
            set.status = 400;
            return {
              success: false,
              error: "storeId and type are required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const end = endDate ? new Date(endDate) : new Date();

          let csvData = "";

          switch (type) {
            case "channels":
              const channelData = await analyticsService.getChannelPerformance(
                storeId,
                { start, end }
              );
              csvData = formatChannelDataToCsv(channelData);
              break;

            default:
              set.status = 400;
              return {
                success: false,
                error: "Invalid export type. Supported: channels",
              };
          }

          set.headers["Content-Type"] = "text/csv";
          set.headers[
            "Content-Disposition"
          ] = `attachment; filename="analytics-${type}-${storeId}-${
            start.toISOString().split("T")[0]
          }.csv"`;

          return csvData;
        } catch (error) {
          logger.error("Failed to export analytics data", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to export data",
            message: (error as Error).message,
          };
        }
      })
  );

  // Helper method to find biggest dropoff in funnel
  function findBiggestDropoff(
    steps: any[]
  ): { from: string; to: string; dropoffRate: number } | null {
    let biggestDropoff = null;
    let maxDropoff = 0;

    for (let i = 1; i < steps.length; i++) {
      const dropoff =
        steps[i - 1].users > 0
          ? ((steps[i - 1].users - steps[i].users) / steps[i - 1].users) * 100
          : 0;

      if (dropoff > maxDropoff) {
        maxDropoff = dropoff;
        biggestDropoff = {
          from: steps[i - 1].step,
          to: steps[i].step,
          dropoffRate: Math.round(dropoff * 100) / 100,
        };
      }
    }

    return biggestDropoff;
  }

  // Helper method to format channel data as CSV
  function formatChannelDataToCsv(channelData: any[]): string {
    const headers = [
      "Channel",
      "Impressions",
      "Opens",
      "Clicks",
      "Conversions",
      "Revenue",
      "Conversion Rate (%)",
      "Cost Per Conversion",
    ];
    const rows = channelData.map((ch) => [
      ch.channel,
      ch.impressions,
      ch.opens,
      ch.clicks,
      ch.conversions,
      ch.revenue.toFixed(2),
      ch.conversionRate.toFixed(2),
      ch.costPerConversion.toFixed(2),
    ]);

    return [headers, ...rows].map((row) => row.join(",")).join("\n");
  }
};
