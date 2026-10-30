import type { DarazCategoryLeaf } from '../../api/daraz';
import { commissionFor, grossUpPrice, groupOf } from './categoryGroups';

/** What to send to an existing Daraz listing when a product's price or stock changes on QuantumStore. */
export type DarazOffer = {
  price?: number;
  quantity?: number;
  /** Set when a change could not be sent, e.g. the price because the listing's category is unknown. */
  note?: string;
};

/**
 * The Daraz price for a rupee price typed here: the same commission formula as publishing
 * (`price ÷ (1 − commission%)`, rounded up), using the category the listing was created in.
 */
export function darazOfferFor(input: {
  rupees?: number;
  stock?: number | null;
  categoryId: number;
  leaves: DarazCategoryLeaf[] | undefined;
}): DarazOffer {
  const offer: DarazOffer = {};
  if (input.rupees !== undefined && input.rupees > 0) {
    const leaf = input.leaves?.find((candidate) => candidate.id === input.categoryId);
    if (leaf) offer.price = grossUpPrice(input.rupees, commissionFor(groupOf(leaf.path)));
    else offer.note = "the Daraz price was not changed because the listing's category could not be looked up";
  }
  if (input.stock !== undefined && input.stock !== null && Number.isInteger(input.stock) && input.stock >= 0) {
    offer.quantity = input.stock;
  }
  return offer;
}

/** True when there is something to send. */
export function hasOffer(offer: DarazOffer) {
  return offer.price !== undefined || offer.quantity !== undefined;
}
