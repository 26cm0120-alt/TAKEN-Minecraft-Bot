export function toolCondition(item,registry){
 const max=registry.items[item?.network_id]?.maxDurability;
 if(!item?.count||!Number.isFinite(max)||max<=0)return null;
 const extra=item.extra,nbt=extra?.nbt?.nbt ?? extra?.nbt;
 const where=registry.supportFeature?.('whereDurabilityIsSerialized');
 let used;
 if(where==='metadata')used=item.metadata;
 else {
  if(nbt&&!nbt.value)return null;
  if(!nbt&&![undefined,false,0,'false'].includes(extra?.has_nbt))return null;
  used=nbt?.value?.Damage?.value ?? 0;
 }
 if(!Number.isInteger(used)||used<0||used>max)return null;
 return {remaining:max-used,max,ratio:(max-used)/max};
}
