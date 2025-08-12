import { Elysia, Context } from "@libs/elysia-server";
import { container } from "../container";
import { CampaignsService } from "./campaigns.service";

import {
  CampaignCreateRequest,
  CampaignUpdateRequest,
  CampaignListFilter,
} from "./types";

const campaignsRoutes = new Elysia({ prefix: "/campaigns" })
  .get("/", async (ctx: Context) => {
    const service = container.getService<CampaignsService>("campaignsService");
    const { storeId, ...filter } = ctx.query as unknown as {
      storeId: string;
    } & Partial<CampaignListFilter>;
    return await service.listCampaigns(storeId, filter);
  })
  .get("/:id", async (ctx: Context) => {
    const service = container.getService<CampaignsService>("campaignsService");
    const { id } = ctx.params as { id: string };
    const { storeId } = ctx.query as { storeId: string };
    return await service.getCampaign(id, storeId);
  })
  .post("/", async (ctx: Context) => {
    const service = container.getService<CampaignsService>("campaignsService");
    const { storeId, createdBy, ...request } =
      ctx.body as CampaignCreateRequest & {
        storeId: string;
        createdBy: string;
      };
    return await service.createCampaign(storeId, request, createdBy);
  })
  .put("/:id", async (ctx: Context) => {
    const service = container.getService<CampaignsService>("campaignsService");
    const { id } = ctx.params as { id: string };
    const { storeId, ...request } = ctx.body as CampaignUpdateRequest & {
      storeId: string;
    };
    return await service.updateCampaign(id, storeId, request);
  })
  .delete("/:id", async (ctx: Context) => {
    const service = container.getService<CampaignsService>("campaignsService");
    const { id } = ctx.params as { id: string };
    const { storeId } = ctx.query as { storeId: string };
    return await service.deleteCampaign(id, storeId);
  });

export default campaignsRoutes;
