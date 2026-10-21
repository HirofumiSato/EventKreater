export interface ReceiptRecord {
  id: string;
  eventId: string;
  addressee: string;
  amount: number;
  description: string;
  issuerName: string;
  issuedAt: Date;
}

export function serializeReceipt(receipt: ReceiptRecord, eventTitle: string) {
  return {
    id: receipt.id,
    eventId: receipt.eventId,
    eventTitle,
    addressee: receipt.addressee,
    amount: receipt.amount,
    description: receipt.description,
    issuerName: receipt.issuerName,
    issuedAt: receipt.issuedAt.toISOString(),
  };
}
