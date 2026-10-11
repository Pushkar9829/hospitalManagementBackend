/**
 * Runs a paged list query: { items, page, limit, total } (spec "Conventions").
 * `allowedSort` whitelists sortable fields so clients cannot sort on unindexed paths.
 */
export async function paginate(
  Model,
  filter,
  { page = 1, limit = 25, sort },
  { allowedSort = ['createdAt'], defaultSort = '-createdAt', select, map } = {},
) {
  const sortKey = sort && allowedSort.includes(sort.replace(/^-/, '')) ? sort : defaultSort;
  const [items, total] = await Promise.all([
    Model.find(filter)
      .sort(sortKey)
      .skip((page - 1) * limit)
      .limit(limit)
      .select(select)
      .lean(),
    Model.countDocuments(filter),
  ]);
  return { items: map ? items.map(map) : items, page, limit, total };
}
