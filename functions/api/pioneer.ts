import { limitRequestBody, optionsResponse, type PagesContextLike } from './auth/_shared';
import { handlePioneerProxyRequest } from '../../services/ai/pioneerProxyCore';

export const onRequestOptions = async (): Promise<Response> => optionsResponse();

export const onRequestPost = async ({ request }: PagesContextLike): Promise<Response> => {
  const limited = await limitRequestBody(request);
  if (limited instanceof Response) return limited;
  return handlePioneerProxyRequest(limited);
};
