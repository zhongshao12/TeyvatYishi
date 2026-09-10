import { limitRequestBody, optionsResponse, type PagesContextLike } from './auth/_shared';
import { handleOpenCodeProxyRequest } from '../../services/ai/opencodeProxyCore';

export const onRequestOptions = async (): Promise<Response> => optionsResponse();

export const onRequestPost = async ({ request }: PagesContextLike): Promise<Response> => {
  const limited = await limitRequestBody(request);
  if (limited instanceof Response) return limited;
  return handleOpenCodeProxyRequest(limited);
};
