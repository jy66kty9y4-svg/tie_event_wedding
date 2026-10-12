export function isVenueSelection(selection, categories = []) {
  const data = selection?.data || selection || {};
  const category = categories.find(item => item.id === data.categoryId);
  return !!data.venue || ['площадка','площадки'].includes(String(category?.data?.name || data.categoryName || '').trim().toLocaleLowerCase('ru'));
}

export function weddingVendorCategories(selections, includeArchived=false) {
  const categories=new Map();
  for(const selection of selections) {
    const data=selection?.data||selection||{};
    if(data.archived&&!includeArchived)continue;
    const name=data.categoryName||'Без категории';
    const key=data.categoryId||`name:${name}`;
    const category=categories.get(key);
    if(category)category.count++;
    else categories.set(key,{name,count:1});
  }
  return categories;
}
