'use client';

import { ProductCatalog } from '@/components/products/product-catalog';

/**
 * Produtos.
 *
 * A destination rather than a settings tab, which is the decision the
 * products plan made and the one this route corrects — see the note at
 * the top of `ProductCatalog`. The page itself is a thin shell for the
 * same reason every other route in this app is: the work lives in the
 * component, and the route exists so the menu has somewhere to point.
 */
export default function ProductsPage() {
  return <ProductCatalog />;
}
