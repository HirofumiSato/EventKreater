import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

export {
  DEFAULT_CHECKOUT_RETURN_TO,
  checkoutReturnUrls,
  isAllowedCheckoutReturnTo,
  normalizeCheckoutReturnTo,
} from "@/modules/billing/lib/checkout-return";

/**
 * Checkout に載せる下書きが、その会員のもので未公開であることを確かめる。
 * 他人の下書き ID を渡して購入させないための入口。
 */
export async function assertOwnDraft(userId: string, draftId: string): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: draftId, isDeleted: false },
    select: {
      status: true,
      organizers: { where: { role: "OWNER" }, select: { userId: true } },
    },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "下書きが見つかりません。",
    });
  }
  if (event.organizers[0]?.userId !== userId) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "この下書きを購入する権限がありません。",
    });
  }
  if (event.status !== "DRAFT") {
    throw new ProblemDetailException({
      status: 409,
      title: "Conflict",
      detail: "このイベントはすでに公開されています。",
      error: "ALREADY_PUBLISHED",
    });
  }
}
