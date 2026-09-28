async function post(body:any){const r=await fetch("/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error("Request failed");return r.json()}
export const getDashboard=()=>post({action:"dashboard"});
export const getCustomers=()=>post({action:"customers"});
export const getOrders=()=>post({action:"orders"});
export const getProducts=()=>post({action:"products"});
export const createCustomer=({data}:{data:any})=>post({action:"createCustomer",...data});
export const createOrder=({data}:{data:any})=>post({action:"createOrder",...data});
export const updateOrderStatus=({data}:{data:any})=>post({action:"updateOrderStatus",...data});
export const updateProduct=({data}:{data:any})=>post({action:"updateProduct",...data});
export const updateShipment=({data}:{data:any})=>post({action:"updateShipment",...data});
export const logout=()=>post({action:"logout"});
export const login=(password:string)=>post({action:"login",password});
export const getPublicTracking=(id:string)=>post({action:"track",id});
