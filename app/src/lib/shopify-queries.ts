export const SHOP_QUERY = `query CrmShop { shop { name myshopifyDomain currencyCode taxesIncluded } currentAppInstallation { accessScopes { handle } } }`;
export const PRODUCT_IDS = `query CrmProducts($after: String) { products(first: 5, after: $after, sortKey: ID) { nodes { id } pageInfo { endCursor hasNextPage } } }`;
export const ORDER_IDS = `query CrmOrders($after: String) { orders(first: 5, after: $after, sortKey: CREATED_AT) { nodes { id } pageInfo { endCursor hasNextPage } } }`;
export const PRODUCT_QUERY = `query CrmProduct($id: ID!, $after: String) { product(id: $id) { id title status featuredImage { url } variants(first: 100, after: $after) { nodes { id title sku price inventoryQuantity taxable } pageInfo { endCursor hasNextPage } } } }`;
export const ORDER_QUERY = `query CrmOrder($id: ID!, $after: String) { order(id: $id) {
 id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus email phone taxesIncluded paymentGatewayNames
 shippingAddress { name phone address1 address2 city province zip countryCodeV2 }
 billingAddress { name phone address1 address2 city province zip countryCodeV2 }
 totalPriceSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount currencyCode } } totalShippingPriceSet { shopMoney { amount currencyCode } }
 lineItems(first: 100, after: $after) { nodes { id name quantity originalTotalSet { shopMoney { amount currencyCode } } discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } } taxLines { priceSet { shopMoney { amount currencyCode } } } variant { id } } pageInfo { endCursor hasNextPage } }
} }`;
export const WEBHOOK_LIST = `query CrmWebhooks($after: String) { webhookSubscriptions(first: 100, after: $after) { nodes { id topic uri } pageInfo { endCursor hasNextPage } } }`;
export const WEBHOOK_CREATE = `mutation CrmSubscribe($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) { webhookSubscription { id } userErrors { field message } } }`;
