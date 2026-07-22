import { products } from '@prisma/client';

/** ProductResponseDTO shape. categoryId is null-safe (fixes legacy NPEs). */
export function mapProductDTO(p: products) {
  return {
    id: p.id,
    name: p.name,
    unitPrice: p.unit_price != null ? Number(p.unit_price) : null,
    isProductActive: p.is_product_active,
    categoryId: p.category_id ?? null,
  };
}

/** Raw Product entity serialization (business & category @JsonIgnore). */
export function mapProductEntity(p: products) {
  return {
    id: p.id,
    name: p.name,
    unitPrice: p.unit_price != null ? Number(p.unit_price) : null,
    isProductActive: p.is_product_active,
  };
}
