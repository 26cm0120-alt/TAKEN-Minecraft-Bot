export const DEFAULT_BEDROCK_VERSION='1.26.60';
export function configuredBedrockVersion(value=process.env.BEDROCK_VERSION){
 const text=String(value||DEFAULT_BEDROCK_VERSION).trim();
 return ['26.6','26.60','1.26.6'].includes(text)?DEFAULT_BEDROCK_VERSION:text;
}
