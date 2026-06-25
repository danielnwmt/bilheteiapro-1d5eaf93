const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Checkout de produção ainda não está configurado.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-accent/30 bg-accent/10 px-4 py-2 text-center text-sm text-accent-foreground">
        Pagamentos no modo de teste — nenhuma cobrança real é feita.
      </div>
    );
  }
  return null;
}
