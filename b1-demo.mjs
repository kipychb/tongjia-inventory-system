import {checkB1} from './b1-anomaly.mjs';
const samples=[
 {productId:'WATER', suggestedQuantity:20,orderQuantity:20},
 {productId:'WATER', suggestedQuantity:20,orderQuantity:200},
 {productId:'TEA', suggestedQuantity:25,orderQuantity:'200'},
 {productId:'RICE',suggestedQuantity:15,orderQuantity:0},
];
for(const sample of samples) console.log(JSON.stringify(checkB1(sample),null,2));
