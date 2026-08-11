import { ContactList } from '@/components/contact-list';

/** «Контакты» — весь список друзей, поиск и заявки (BUG-36). */
export default function FriendsScreen() {
  return <ContactList mode="friends" />;
}
