import { guardProxyEndpoint, limitRequestBody, optionsResponse, type PagesContextLike } from './auth/_shared';
import { handlePioneerProxyRequest } from '../../services/ai/pioneerProxyCore';

export const onRequestOptions = async (): Promise<Response> => optionsResponse();

export const onRequestPost = async ({ request, env }: PagesContextLike): Promise<Response> => {
  const denied = await guardProxyEndpoint({ request, env }, { scope: 'pioneer' });
  if (denied) return denied;
  const limited = await limitRequestBody(request);
  if (limited instanceof Response) return limited;
  return handlePioneerProxyRequest(limited);
};
