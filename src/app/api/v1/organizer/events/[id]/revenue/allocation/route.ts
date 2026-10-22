import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { summarizeRevenue } from "@/modules/revenue/lib/revenue";
import {
  validateAllocationRows,
  type AllocationInputRow,
  type RevenueShareVisibility,
  type RevenueSplitMode,
} from "@/modules/revenue/lib/allocation";
import { buildAllocationView } from "@/modules/revenue/lib/allocation-view";
import { saveAllocationSetting } from "@/modules/revenue/lib/allocation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

interface ParsedBody {
  mode: RevenueSplitMode;
  visibility: RevenueShareVisibility;
  rows: AllocationInputRow[];
}

function badRequest(detail: string, error = "INVALID_ALLOCATION_BODY"): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail,
    error,
  });
}

function parseBody(raw: unknown): ParsedBody {
  if (!raw || typeof raw !== "object") {
    throw badRequest("リクエストの形式が正しくありません。");
  }
  const body = raw as Record<string, unknown>;
  const mode = body.mode;
  if (mode !== "RATIO" && mode !== "HEADCOUNT") {
    throw badRequest("mode は RATIO か HEADCOUNT を指定してください。");
  }
  const visibility = body.visibility ?? "OWN_ONLY";
  if (visibility !== "ALL" && visibility !== "OWN_ONLY") {
    throw badRequest("visibility は ALL か OWN_ONLY を指定してください。");
  }
  if (!Array.isArray(body.rows)) {
    throw badRequest("rows は配列で指定してください。");
  }
  const rows = body.rows.map((item) => {
    if (!item || typeof item !== "object") {
      throw badRequest("rows の形式が正しくありません。");
    }
    const row = item as Record<string, unknown>;
    if (typeof row.organizerId !== "string" || row.organizerId.length === 0) {
      throw badRequest("rows に organizerId がありません。");
    }
    const readNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw badRequest("配分の値は数値で指定してください。");
      }
      return value;
    };
    return {
      organizerId: row.organizerId,
      shareBps: readNumber(row.shareBps),
      headcount: readNumber(row.headcount),
    };
  });
  return { mode, visibility, rows };
}

/**
 * 共同主催の按分設定。主催者（会員）だけが保存できる。
 * 設定と配分は1トランザクションで upsert し、主催者から外れた行は消す。
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertRegisteredOwner(req, params.id);
    const parsed = parseBody(await req.json().catch(() => null));

    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: {
        id: true,
        organizers: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            userId: true,
            displayName: true,
            user: { select: { name: true } },
          },
        },
        participants: {
          select: {
            status: true,
            priceAmount: true,
            pricePlanName: true,
            priceAudience: true,
            scheduleId: true,
          },
        },
        receipts: { select: { amount: true } },
      },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const summary = summarizeRevenue(event.participants, event.receipts);
    const organizers = event.organizers.map((row) => ({
      organizerId: row.id,
      role: row.role,
    }));

    const problem = validateAllocationRows(
      parsed.mode,
      organizers,
      parsed.rows,
      summary.attendingCount,
    );
    if (problem) {
      throw new ProblemDetailException({
        status: problem.code === "HEADCOUNT_EXCEEDS_ATTENDING" ? 409 : 400,
        title: problem.code === "HEADCOUNT_EXCEEDS_ATTENDING" ? "Conflict" : "Validation Error",
        detail: problem.message,
        error: problem.code,
        ...(problem.attendingCount !== undefined
          ? {
              attendingCount: problem.attendingCount,
              totalHeadcount: problem.totalHeadcount,
            }
          : {}),
      });
    }

    const organizerIds = organizers.map((row) => row.organizerId);
    const values = new Map(parsed.rows.map((row) => [row.organizerId, row]));

    await saveAllocationSetting({
      eventId: event.id,
      mode: parsed.mode,
      visibility: parsed.visibility,
      rows: parsed.rows,
      organizerIds,
      updatedByUserId: ctx.userId,
    });

    const savedShares = organizerIds.map((organizerId) => {
      const row = values.get(organizerId);
      return {
        organizerId,
        shareBps: parsed.mode === "RATIO" ? (row?.shareBps ?? 0) : null,
        headcount: parsed.mode === "HEADCOUNT" ? (row?.headcount ?? 0) : null,
      };
    });

    const allocation = buildAllocationView({
      organizers: event.organizers,
      setting: { mode: parsed.mode, visibility: parsed.visibility },
      shares: savedShares,
      viewerUserId: ctx.userId,
      viewerRole: ctx.role ?? "OWNER",
      expectedRevenue: summary.expectedRevenue,
      issuedRevenue: summary.issuedRevenue,
      attendingCount: summary.attendingCount,
    });

    return NextResponse.json({ allocation });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/revenue/allocation`);
  }
}
