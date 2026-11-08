const normalizeSearch = value => value.normalize('NFKC').toLowerCase();

function searchTerms(query) {
  return normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
}

function matchesSearch(fields, terms) {
  const searchable = fields.filter(value => typeof value === 'string').map(normalizeSearch);
  return terms.every(term => searchable.some(field => field.includes(term)));
}

module.exports = { searchTerms, matchesSearch };
