import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { EditExpenseForm } from "./Form";
import { DeleteExpenseForm } from "./DeleteExpenseForm";

export default async function EditExpense({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const expense = await db.expense.findUnique({ where: { id: params.id } });
  if (!expense) notFound();
  assertOwnership(expense.userId, user);
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "desc" } });

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href="/expenses" className="text-sm text-charcoal-500 underline">← Back to expenses</Link>
      <h1 className="text-2xl font-bold mt-2">Edit expense</h1>
      <EditExpenseForm expense={expense} vehicles={vehicles.map((v) => ({ id: v.id, label: v.nickname ?? `${v.year} ${v.brand} ${v.model}` }))} />
      <DeleteExpenseForm id={expense.id} />
    </div>
  );
}
