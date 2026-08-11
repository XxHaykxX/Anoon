import { ContactList } from '@/components/contact-list';

/**
 * «Чаты» — начатые переписки (BUG-36), стартовый экран после входа. Та же
 * разметка, что и «Контакты»: на вебе это тоже один `AnoonFriends` с `mode`.
 */
export default function ChatsScreen() {
  return <ContactList mode="chats" />;
}
