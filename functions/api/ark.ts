import { limitRequestBody, optionsResponse, type PagesContextLike } from './auth/_shared';
import { handleArkProxyRequest } from '../../services/ai/arkProxyCore';

export const onRequestOptions = async (): Promise<Response> => optionsResponse();

export const onRequestPost = async ({ request }: PagesContextLike): Promise<Response> => {
  const limited = await limitRequestBody(request);
  if (limited instanceof Response) return limited;
  return handleArkProxyRequest(limited);
};
