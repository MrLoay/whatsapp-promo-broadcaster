const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'إلغاء الاشتراك', 'الغاء'];

export function isOptOutMessage(body: string): boolean {
  const lower = body.toLowerCase();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}
