import { imagePromptLibraryStore } from '@/utils/imagePromptLibraryStore';
import { ImagePromptLibraryPickerBase, type ImagePromptLibraryPickerProps } from './ImagePromptLibraryPickerBase';

/** Legacy convenience wrapper. Core2 imports the explicit-store base instead. */
export function ImagePromptLibraryPicker(props: Omit<ImagePromptLibraryPickerProps, 'store'> & { store?: ImagePromptLibraryPickerProps['store'] }) {
  return <ImagePromptLibraryPickerBase {...props} store={props.store ?? imagePromptLibraryStore} />;
}
