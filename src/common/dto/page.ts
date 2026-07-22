/**
 * Reproduces the Spring Data `Page<T>` JSON envelope so paginated endpoints
 * stay contract-compatible with the frontend (react-paginate reads
 * totalPages/totalElements/number).
 */
export function toSpringPage<T>(content: T[], page: number, size: number, totalElements: number) {
  const totalPages = size > 0 ? Math.ceil(totalElements / size) : 0;
  const sort = { sorted: false, unsorted: true, empty: true };
  return {
    content,
    pageable: {
      pageNumber: page,
      pageSize: size,
      offset: page * size,
      paged: true,
      unpaged: false,
      sort,
    },
    totalElements,
    totalPages,
    last: totalPages === 0 ? true : page >= totalPages - 1,
    first: page === 0,
    size,
    number: page,
    numberOfElements: content.length,
    sort,
    empty: content.length === 0,
  };
}
